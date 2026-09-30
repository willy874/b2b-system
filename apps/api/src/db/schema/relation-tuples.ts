import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 關係圖的邊：`物件#關係@主體`（docs/features/permission-graph.md §3、docs/adr/0024-relationship-based-access-control.md）。
 *
 * - 主體是節點（`subject_relation = ''`）、節點的關係（`role:<id>#holder`），或萬用字元（`subject_id = '*'`）。
 * - id 用 text：租戶節點是 `self`、萬用字元是 `*`；多型關聯沒有外鍵，解析時 join 未刪除的節點。
 * - G1～G2：`user_roles`、`role_permissions`、`resource_grants` 仍是事實來源，這張表由它們上面的 trigger 同步
 *   （migration 0008）；G3 起改由程式直接寫入。
 */
export const relationTuples = pgTable(
  'relation_tuples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id').notNull(),
    relation: text('relation').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    /** `''` = 節點本身；不能是 NULL，否則唯一索引擋不住重複。 */
    subjectRelation: text('subject_relation').notNull().default(''),
    /** null = 不過期；過期的邊在解析時忽略。 */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('relation_tuples_key').on(
      t.objectType,
      t.objectId,
      t.relation,
      t.subjectType,
      t.subjectId,
      t.subjectRelation,
    ),
    // 從主體往外走（主體閉包、「這個人／角色有哪些邊」）
    index('relation_tuples_subject_idx').on(t.subjectType, t.subjectId, t.subjectRelation),
    // 從物件往回查（「誰在這個物件上有這個關係」）
    index('relation_tuples_object_idx').on(t.objectType, t.objectId, t.relation),
  ],
);

export type RelationTupleRow = typeof relationTuples.$inferSelect;
export type RelationTupleInsert = typeof relationTuples.$inferInsert;
