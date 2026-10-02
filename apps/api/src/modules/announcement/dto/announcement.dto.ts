import { z } from 'zod';

import { PaginationSchema } from '@/core/http';
import { defineSchema } from '@/core/validation';
import { ANNOUNCEMENT_DISPATCH_STATUSES, ANNOUNCEMENT_STATUSES } from '@/db/schema';

import {
  ANNOUNCEMENT_AUDIENCE_MAX_PER_KIND,
  ANNOUNCEMENT_RECURRENCE_MAX_INTERVAL,
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
} from '../announcement.constants';

export const AnnouncementStatusSchema = z.enum(ANNOUNCEMENT_STATUSES);
export const AnnouncementDispatchStatusSchema = z.enum(ANNOUNCEMENT_DISPATCH_STATUSES);

const IdsSchema = z
  .array(z.string().uuid())
  .max(ANNOUNCEMENT_AUDIENCE_MAX_PER_KIND)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate ids' });

/** 受眾（docs/adr/0031-announcements.md D5）：四種來源取聯集；全部空著的可以存草稿，不能送出。 */
export const AnnouncementAudienceSchema = defineSchema(
  'AnnouncementAudience',
  z.object({
    /** 全租戶（可登入的使用者）。 */
    all: z.boolean().default(false),
    userIds: IdsSchema.default([]),
    groupIds: IdsSchema.default([]),
    roleIds: IdsSchema.default([]),
  }),
);

const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/**
 * 週期（D7）：依租戶時區的日曆計算。週需要 `weekdays`（0＝週日～6），月需要 `monthDay`（1～28 或 `last`）。
 * 不收 cron 字串：不存在的日期（31 日、2 月 30 日）由選項本身排除。
 */
const RecurringTriggerSchema = z
  .object({
    kind: z.literal('recurring'),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    interval: z.number().int().min(1).max(ANNOUNCEMENT_RECURRENCE_MAX_INTERVAL),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
    monthDay: z
      .union([z.number().int().min(1).max(28), z.literal('last')])
      .nullable()
      .optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm'),
    startsOn: DaySchema,
    endsOn: DaySchema.nullable().optional(),
    maxOccurrences: z.number().int().min(1).max(10_000).nullable().optional(),
  })
  .superRefine((trigger, ctx) => {
    if (trigger.frequency === 'weekly') {
      const weekdays = trigger.weekdays ?? [];
      if (weekdays.length === 0 || new Set(weekdays).size !== weekdays.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['weekdays'],
          message: 'weekly needs distinct weekdays',
        });
      }
    }
    if (trigger.frequency === 'monthly' && (trigger.monthDay ?? null) === null) {
      ctx.addIssue({ code: 'custom', path: ['monthDay'], message: 'monthly needs monthDay' });
    }
    if (trigger.endsOn && trigger.endsOn < trigger.startsOn) {
      ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'must not be before startsOn' });
    }
  });

/**
 * 觸發方式（D7）：立即、指定時間、週期。事件點（A4）之後加入同一個 union。
 * `once.at` 是 ISO 8601（帶時區）；送出時必須在未來。
 */
export const AnnouncementTriggerSchema = defineSchema(
  'AnnouncementTrigger',
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('immediate') }),
    z.object({ kind: z.literal('once'), at: z.string().datetime({ offset: true }) }),
    RecurringTriggerSchema,
  ]),
);

/** `POST /announcements/recurrence-preview`：週期 → 接下來幾次（租戶時區）。 */
export const RecurrencePreviewRequestSchema = defineSchema(
  'AnnouncementRecurrencePreviewRequest',
  z.object({ trigger: RecurringTriggerSchema }),
);

export const RecurrencePreviewSchema = defineSchema(
  'AnnouncementRecurrencePreview',
  z.object({
    /** 計算用的時區（租戶的 `general.defaultTimezone`）。 */
    timeZone: z.string(),
    /** 接下來最多 5 次（ISO 8601）；沒有了（已過結束日期）是空陣列。 */
    occurrences: z.array(z.string()),
  }),
);

const PersonSchema = z.object({ id: z.string().uuid(), displayName: z.string() }).nullable();

export const AnnouncementSchema = defineSchema(
  'Announcement',
  z.object({
    id: z.string().uuid(),
    title: z.string(),
    body: z.string(),
    audience: AnnouncementAudienceSchema,
    trigger: AnnouncementTriggerSchema,
    status: AnnouncementStatusSchema,
    /** 排程中的下一次發送；不在排程中時為 null。 */
    nextRunAt: z.string().nullable(),
    /** 最近一次發送（列表顯示已讀率）；還沒發過為 null。 */
    lastDispatch: z
      .object({
        id: z.string().uuid(),
        status: AnnouncementDispatchStatusSchema,
        scheduledFor: z.string(),
        recipientCount: z.number().int().nullable(),
        readCount: z.number().int(),
      })
      .nullable(),
    /** 樂觀鎖版本：`PATCH` 時帶上（ADR-0025 D3）。 */
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: PersonSchema,
    updatedBy: PersonSchema,
  }),
);

export const ListAnnouncementSchema = PaginationSchema.extend({
  keyword: z.string().trim().max(100).optional(),
  status: AnnouncementStatusSchema.optional(),
});

export const CreateAnnouncementSchema = defineSchema(
  'CreateAnnouncementRequest',
  z.object({
    title: z.string().trim().min(1).max(ANNOUNCEMENT_TITLE_MAX),
    body: z.string().trim().min(1).max(ANNOUNCEMENT_BODY_MAX),
    audience: AnnouncementAudienceSchema,
    trigger: AnnouncementTriggerSchema,
  }),
);

export const UpdateAnnouncementSchema = defineSchema(
  'UpdateAnnouncementRequest',
  z
    .object({
      title: z.string().trim().min(1).max(ANNOUNCEMENT_TITLE_MAX).optional(),
      body: z.string().trim().min(1).max(ANNOUNCEMENT_BODY_MAX).optional(),
      audience: AnnouncementAudienceSchema.optional(),
      trigger: AnnouncementTriggerSchema.optional(),
      /** 樂觀鎖：編輯開始時看到的 `version`（必填）。 */
      version: z.number().int().min(1),
    })
    .refine(
      (dto) =>
        dto.title !== undefined ||
        dto.body !== undefined ||
        dto.audience !== undefined ||
        dto.trigger !== undefined,
      { message: 'at least one field' },
    ),
);

/** 送出、暫停、恢復：帶目前的 `version`，避免依據過時的畫面操作。 */
export const AnnouncementActionSchema = defineSchema(
  'AnnouncementActionRequest',
  z.object({ version: z.number().int().min(1) }),
);

export const AudiencePreviewSchema = defineSchema(
  'AnnouncementAudiencePreview',
  z.object({
    /** 現在送出的話會收到的人數（可登入的使用者；不扣除租戶關掉站內通知或送出者自己）。 */
    count: z.number().int(),
    /** 已刪除或不存在而略過的來源。 */
    skipped: z.object({
      userIds: z.array(z.string().uuid()),
      groupIds: z.array(z.string().uuid()),
      roleIds: z.array(z.string().uuid()),
    }),
  }),
);

export const AnnouncementDispatchSchema = defineSchema(
  'AnnouncementDispatch',
  z.object({
    id: z.string().uuid(),
    announcementId: z.string().uuid(),
    scheduledFor: z.string(),
    title: z.string(),
    body: z.string(),
    audience: AnnouncementAudienceSchema,
    status: AnnouncementDispatchStatusSchema,
    /** 實際寫入的通知數；發送完成才有值。撤回後保留原本的數字。 */
    recipientCount: z.number().int().nullable(),
    /** 目前還在的通知裡已讀的數量（撤回、保留清理後會變少）。 */
    readCount: z.number().int(),
    /** 略過的來源（`skipped`）、失敗的原因（`reason`：`tooManyRecipients`，`count`、`max`）。 */
    details: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    createdBy: PersonSchema,
    revokedBy: PersonSchema,
  }),
);

export const ListAnnouncementDispatchSchema = PaginationSchema;

/** 收件人看到的全文（`GET /me/announcement-messages/:dispatchId`）。 */
export const AnnouncementMessageSchema = defineSchema(
  'AnnouncementMessage',
  z.object({
    dispatchId: z.string().uuid(),
    title: z.string(),
    body: z.string(),
    sentAt: z.string(),
    /** 送出的人；那個人已被永久刪除時為 null。 */
    sender: PersonSchema,
  }),
);

export type AnnouncementDto = z.infer<typeof AnnouncementSchema>;
export type ListAnnouncementDto = z.infer<typeof ListAnnouncementSchema>;
export type CreateAnnouncementDto = z.infer<typeof CreateAnnouncementSchema>;
export type UpdateAnnouncementDto = z.infer<typeof UpdateAnnouncementSchema>;
export type AnnouncementActionDto = z.infer<typeof AnnouncementActionSchema>;
export type AnnouncementAudienceDto = z.infer<typeof AnnouncementAudienceSchema>;
export type AnnouncementTriggerDto = z.infer<typeof AnnouncementTriggerSchema>;
export type AudiencePreviewDto = z.infer<typeof AudiencePreviewSchema>;
export type AnnouncementDispatchDto = z.infer<typeof AnnouncementDispatchSchema>;
export type ListAnnouncementDispatchDto = z.infer<typeof ListAnnouncementDispatchSchema>;
export type AnnouncementMessageDto = z.infer<typeof AnnouncementMessageSchema>;
export type RecurrencePreviewRequestDto = z.infer<typeof RecurrencePreviewRequestSchema>;
export type RecurrencePreviewDto = z.infer<typeof RecurrencePreviewSchema>;
