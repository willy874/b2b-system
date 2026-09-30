import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 版本歷史（docs/architecture/backend/14-revisions.md、ADR-0025 D1）：選擇性加入的實體每次寫入後存一份 **整份** 快照。
 *
 * - `resource_type` 是 text ＋ 程式常數（`core/resource/resource-types.ts`），不是 Postgres enum（ADR-0025 D7、02-database.md §1 的例外）。
 * - `version` 是每個資源自己的流水號（1, 2, 3…），由 `RevisionService.record` 在擁有者鎖住實體列的交易內以 `max + 1` 產生；
 *   與實體的樂觀鎖 `version` 無關（關聯的寫入不遞增實體的 `version`，但會產生新的一版）。
 * - `snapshot` 為 null：那一版超過單版上限（1 MiB），業務寫入照常成功但沒有保存內容（列表標示「過大未保存」）。
 */
export const revisions = pgTable(
  'revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>(),
    // 永久刪除使用者時保留版本（作者變成 null）；與 created_by 之類的欄位同一個規則（13-trash.md §4.2）
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 唯一鍵的索引同時服務「某個資源的版本，新的在前」與 max(version)（倒序掃描同一個索引）
    unique('revisions_resource_version_key').on(t.resourceType, t.resourceId, t.version),
    // 保留清理（revision.prune）以時間篩選
    index('revisions_created_at_idx').on(t.createdAt),
  ],
);

export type RevisionRow = typeof revisions.$inferSelect;
