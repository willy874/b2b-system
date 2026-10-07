import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

export const approvalStatus = pgEnum('approval_status', ['pending', 'approved', 'rejected']);

/**
 * 需要管理員核准才會生效的變更請求（docs/architecture/backend/20-approval.md）。
 * 請求本身只記錄「想做什麼」；核准時由對應類型的 handler 真正套用。
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 請求類型（`user.register`）；對應 `ApprovalHandlerRegistry` 裡的 handler。 */
    type: text('type').notNull(),
    status: approvalStatus('status').notNull().default('pending'),
    /** 同類型同對象的去重鍵（註冊 = 小寫 email）：同時只能有一筆待審。 */
    subjectKey: text('subject_key').notNull(),
    /** 審核者看得到的內容。 */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** 只給 handler 用、永不回傳也不進稽核的內容（例：註冊時的密碼雜湊）；審核後清空。 */
    privatePayload: jsonb('private_payload').$type<Record<string, unknown>>(),

    /** 匿名請求（註冊）為 null。 */
    requesterId: uuid('requester_id').references(() => users.id, { onDelete: 'set null' }),
    /** 申請人快照（註冊 = email）：列表不需 join，申請人刪除後仍可讀。 */
    requesterName: text('requester_name').notNull(),
    reason: text('reason'),

    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    reviewerName: text('reviewer_name'),
    reviewComment: text('review_comment'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** 核准後產生／異動的資源（註冊 = 新使用者的 id）。 */
    resultResourceId: text('result_resource_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 已審核 ⇔ 有審核時間；待審的請求不可能帶著審核結果
    check(
      'approval_requests_reviewed_consistency',
      sql`(${t.status} = 'pending') = (${t.reviewedAt} IS NULL)`,
    ),
    uniqueIndex('approval_requests_pending_subject_key')
      .on(t.type, t.subjectKey)
      .where(sql`${t.status} = 'pending'`),
    index('approval_requests_status_created_idx').on(t.status, t.createdAt.desc()),
    index('approval_requests_created_idx').on(t.createdAt.desc()),
  ],
);

export type ApprovalRequestRow = typeof approvalRequests.$inferSelect;
export type ApprovalRequestInsert = typeof approvalRequests.$inferInsert;
export type ApprovalStatus = (typeof approvalStatus.enumValues)[number];
