import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { notDeleted } from './soft-delete';
import { users } from './users';

/**
 * 公告的受眾（docs/adr/0031-announcements.md D5）：四種來源取聯集，發送當下才解析成人（快照）。
 * 存的是定義（id），不是人名單。
 */
export interface AnnouncementAudienceValue {
  all: boolean;
  userIds: string[];
  groupIds: string[];
  roleIds: string[];
}

/**
 * 週期（D7）：依租戶時區（`general.defaultTimezone`）的日曆計算，`time` 是當地的 `HH:mm`。
 * `weekdays` 是 0（週日）～6，只在 `weekly` 用；`monthDay` 只在 `monthly` 用（不收 29～31，月底用 `last`）。
 */
export interface AnnouncementRecurringTrigger {
  kind: 'recurring';
  frequency: 'daily' | 'weekly' | 'monthly';
  /** 每 N 天／週／月（1～99）。 */
  interval: number;
  weekdays?: number[] | null;
  monthDay?: number | 'last' | null;
  time: string;
  /** 第一天（`YYYY-MM-DD`，租戶時區）；週與月的間隔從這一天所在的週、月算起。 */
  startsOn: string;
  /** 最後一天（含）；null＝不結束。 */
  endsOn?: string | null;
  /** 最多發幾次；null＝不限。 */
  maxOccurrences?: number | null;
}

/**
 * 觸發方式（D7）。事件點（`event`）由 A4 加入；欄位是 jsonb，加入新的種類不必改表。
 */
export type AnnouncementTriggerValue =
  | { kind: 'immediate' }
  | { kind: 'once'; at: string }
  | AnnouncementRecurringTrigger;

export const ANNOUNCEMENT_STATUSES = ['draft', 'scheduled', 'paused', 'completed'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_DISPATCH_STATUSES = [
  'pending',
  'sending',
  'sent',
  'failed',
  'revoked',
] as const;
export type AnnouncementDispatchStatus = (typeof ANNOUNCEMENT_DISPATCH_STATUSES)[number];

/**
 * 公告（D3）：管理者編輯的定義。可編輯、有樂觀鎖、軟刪除進回收桶（D19）。
 * `next_run_at` 是排程中的下一次；排程以延遲工作實作（D8），工作上的時間與它不同就不執行。
 */
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    audience: jsonb('audience').$type<AnnouncementAudienceValue>().notNull(),
    trigger: jsonb('trigger').$type<AnnouncementTriggerValue>().notNull(),
    status: text('status').$type<AnnouncementStatus>().notNull().default('draft'),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'announcements_status_check',
      sql`${t.status} IN ('draft', 'scheduled', 'paused', 'completed')`,
    ),
    // 列表（新的在前）
    index('announcements_created_idx').on(t.createdAt, t.id),
    // 每天的補排程（A3 的 reconcile）找「排程中」的公告
    index('announcements_next_run_idx')
      .on(t.nextRunAt)
      .where(sql`${t.status} = 'scheduled' AND ${t.deletedAt} IS NULL`),
  ],
);

/**
 * 一次實際送出（D3）：內容與受眾定義的快照、計畫時間、人數、狀態。通知以 `notifications.source_id` 指向它（D4）。
 * 公告被永久刪除時一起刪掉；通知不加外鍵，依自己的保留期清除。
 */
export const announcementDispatches = pgTable(
  'announcement_dispatches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    /** 計畫的發送時間（`immediate` 是送出的當下）。 */
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    audience: jsonb('audience').$type<AnnouncementAudienceValue>().notNull(),
    status: text('status').$type<AnnouncementDispatchStatus>().notNull().default('pending'),
    /** 實際寫入的通知數（略過自己、租戶關掉站內通知的不算）；發送完成才有值。 */
    recipientCount: integer('recipient_count'),
    /** 解析受眾時略過的來源（已刪除或不存在的使用者、群組、角色）與失敗的原因。 */
    details: jsonb('details').$type<Record<string, unknown>>(),
    /** 送出（或排程）這次發送的人；系統排程的發送沿用排程的人。 */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check(
      'announcement_dispatches_status_check',
      sql`${t.status} IN ('pending', 'sending', 'sent', 'failed', 'revoked')`,
    ),
    // 同一則公告的同一個時間只發一次（延遲工作重做、兩個 worker 同時拿到也不重複）
    uniqueIndex('announcement_dispatches_once_key').on(t.announcementId, t.scheduledFor),
    // 發送紀錄（新的在前）
    index('announcement_dispatches_announcement_idx').on(t.announcementId, t.createdAt, t.id),
  ],
);

export type AnnouncementRow = typeof announcements.$inferSelect;
export type AnnouncementInsert = typeof announcements.$inferInsert;
export type AnnouncementDispatchRow = typeof announcementDispatches.$inferSelect;
export type AnnouncementDispatchInsert = typeof announcementDispatches.$inferInsert;

/** 未刪除的公告＝`notDeleted(announcements)` 的別名。 */
export function isActiveAnnouncement(): SQL {
  return notDeleted(announcements);
}
