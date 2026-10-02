import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** 入列時的選項，搬進佇列時照原樣帶上。 */
export interface JobOutboxOptions {
  throttle?: { key: string; seconds: number };
  startAfter?: string;
}

/**
 * 交易內入列的暫存（docs/architecture/05-tenancy.md §10.2 D15）：佇列在平台 DB，
 * 業務交易在租戶 DB，兩者不能在同一個交易裡寫入。交易內先寫這張表，提交後搬進佇列；
 * `id` 就是佇列裡的工作 id，重複搬也只會有一筆工作。
 */
export const jobOutbox = pgTable(
  'job_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    options: jsonb('options').$type<JobOutboxOptions>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('job_outbox_created_idx').on(t.createdAt)],
);

export type JobOutboxRow = typeof jobOutbox.$inferSelect;
