import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * Webhook 訂閱（docs/adr/0030-webhooks.md D7）：租戶的設定，不是業務資料——硬刪除、不進回收桶。
 * 密鑰要拿來算 HMAC，不能只存雜湊：以 `WEBHOOK_SECRET_KEY` 加密（D14）。
 */
export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    /** 訂閱的對外事件名稱（`defineWebhookEvent` 的 `type`）；不認得的名稱讀取時忽略。 */
    events: text('events').array().notNull(),
    /** `active` ｜ `disabled`。 */
    status: text('status').notNull().default('active'),
    /** 停用的原因：`manual`（有人停用）｜ `failing`（連續失敗自動停用，D13）；啟用時清空。 */
    disabledReason: text('disabled_reason'),
    secretEncrypted: text('secret_encrypted').notNull(),
    /** 連續失敗的投遞次數；成功歸零，到門檻自動停用（D13）。 */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('webhook_subscriptions_status_check', sql`${t.status} IN ('active', 'disabled')`),
    // `emit()` 在業務交易內找「訂閱了這個事件的啟用中訂閱」
    index('webhook_subscriptions_events_idx')
      .using('gin', t.events)
      .where(sql`${t.status} = 'active'`),
  ],
);

/**
 * 發出的對外事件（D9）：擁有者在業務交易內寫入，投遞工作以 id 讀取。只在有訂閱時才寫；保留 30 天（D16）。
 * `data` 只有 id 與列舉值（D3），工作資料只放事件 id。
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    version: integer('version').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webhook_events_occurred_at_idx').on(t.occurredAt)],
);

/** 每一次投遞嘗試一列（D12）：成功或失敗、狀態碼、耗時、回應開頭。隨訂閱或事件刪除。 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => webhookEvents.id, { onDelete: 'cascade' }),
    /** 這個事件對這個訂閱的第幾次嘗試（1 起算；手動重送接續）。 */
    attempt: integer('attempt').notNull(),
    /** `auto`（投遞工作與它的重試）｜ `manual`（重送，D17）。 */
    trigger: text('trigger').notNull(),
    succeeded: boolean('succeeded').notNull(),
    /** 沒有收到回應（逾時、連線失敗、被擋下）時為 null。 */
    responseStatus: integer('response_status'),
    durationMs: integer('duration_ms').notNull(),
    /** 回應內容的開頭（最多 1 KB）。 */
    responseBody: text('response_body'),
    /** 沒有收到回應時的原因代碼（`TIMEOUT`、`BLOCKED`、`ECONNREFUSED`…）。 */
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('webhook_deliveries_trigger_check', sql`${t.trigger} IN ('auto', 'manual')`),
    // 投遞紀錄頁：一個訂閱的紀錄新到舊（keyset 以 id 收尾）
    index('webhook_deliveries_subscription_idx').on(t.subscriptionId, t.createdAt.desc(), t.id),
    index('webhook_deliveries_event_idx').on(t.eventId),
  ],
);

export type WebhookSubscriptionRow = typeof webhookSubscriptions.$inferSelect;
export type WebhookSubscriptionInsert = typeof webhookSubscriptions.$inferInsert;
export type WebhookEventRow = typeof webhookEvents.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
