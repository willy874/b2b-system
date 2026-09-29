import { index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 可以被授權的資源種類（docs/rbac/07-resource-grants.md §8、§10）。
 * 新增種類（專案、關卡）時加一個值：`ALTER TYPE … ADD VALUE`。
 */
export const RESOURCE_TYPES = ['fileFolder'] as const;
export const resourceType = pgEnum('resource_type', RESOURCE_TYPES);
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * 授權對象：角色（持有者隨角色指派變動）、個別使用者，或 `everyone`
 * （所有能進檔案管理器的人；`subject_id` 固定是 `EVERYONE_SUBJECT_ID`，docs/rbac/07-resource-grants.md §6.2）。
 */
export const GRANT_SUBJECT_TYPES = ['role', 'user', 'everyone'] as const;

/** `subject_type = everyone` 的 `subject_id`：唯一索引需要一個固定值。 */
export const EVERYONE_SUBJECT_ID = '00000000-0000-0000-0000-000000000000';
export const grantSubjectType = pgEnum('grant_subject_type', GRANT_SUBJECT_TYPES);
export type GrantSubjectType = (typeof GRANT_SUBJECT_TYPES)[number];

/** 等級是全序：陣列的順序就是由低到高（§2）。 */
export const GRANT_LEVELS = ['viewer', 'contributor', 'editor', 'manager'] as const;
export const grantLevel = pgEnum('grant_level', GRANT_LEVELS);
export type GrantLevel = (typeof GRANT_LEVELS)[number];

/**
 * 資源 × 對象 × 等級（Zanzibar 的 `(object, relation, subject)` tuple）。
 * `subject_id` 沒有外鍵（多型）：解析與清單都 join 未刪除的 roles / users，
 * 刪除角色或使用者不必清這張表。
 */
export const resourceGrants = pgTable(
  'resource_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceType: resourceType('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    subjectType: grantSubjectType('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    level: grantLevel('level').notNull(),
    /** null = 不過期；過期的授權在解析時忽略，不需要排程清除（§6.3）。 */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    // 同一對象在同一資源只有一筆：變更等級是覆寫
    uniqueIndex('resource_grants_resource_subject_key').on(
      t.resourceType,
      t.resourceId,
      t.subjectType,
      t.subjectId,
    ),
    // 「這個人／角色有哪些授權」（解析時以對象集合查詢）
    index('resource_grants_subject_idx').on(t.subjectType, t.subjectId),
  ],
);

export type ResourceGrantRow = typeof resourceGrants.$inferSelect;
export type ResourceGrantInsert = typeof resourceGrants.$inferInsert;
