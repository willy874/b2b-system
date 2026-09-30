import { and, eq, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 關係圖的邊：`物件#關係@主體`（docs/features/permission-graph.md §3、docs/adr/0024-relationship-based-access-control.md）。
 *
 * - 主體是節點（`subject_relation = ''`）、節點的關係（`role:<id>#holder`），或萬用字元（`subject_id = '*'`）。
 * - id 用 text：租戶節點是 `self`、萬用字元是 `*`；多型關聯沒有外鍵，解析時 join 未刪除的節點。
 * - G3 起由程式直接寫入（G1～G2 由舊表上的 trigger 同步，migration 0008；trigger 在 0009 刪除）。
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

/**
 * 關係圖的版本號（單列，docs/adr/0024-relationship-based-access-control.md D7）：`relation_tuples` 的每一條寫入語句
 * 由 trigger 在同一個交易內 +1（migration 0009）。寫入之間因此以這一列的鎖排隊，提交順序＝版本順序；
 * 各程序以它判斷收到的失效通知是不是比已知的新。
 */
export const authzRevision = pgTable(
  'authz_revision',
  {
    id: boolean('id').primaryKey().default(true),
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  },
  (t) => [check('authz_revision_single_row', sql`${t.id}`)],
);

// ── 核心的邊（docs/features/permission-graph.md §2）──────────────────────
// G3 起取代 user_roles、role_permissions、resource_grants；repository、seed、測試共用下面的
// 建構函式與條件，邊的形狀只寫在這裡。
//
// 多型的 id 是 text：與 uuid 欄位比較時一律把 uuid 那邊轉成 text（`roles.id::text = object_id`），
// 不要把 object_id 轉成 uuid——租戶節點是 `self`、萬用字元是 `*`，轉型可能在過濾之前就執行而失敗。

/** 每個租戶 DB 只有一個租戶節點。 */
export const TENANT_OBJECT_TYPE = 'tenant';
export const TENANT_OBJECT_ID = 'self';
/** super-admin 在租戶節點上的關係（隱含全集）。 */
export const SUPER_ADMIN_RELATION = 'superAdmin';
export const ROLE_OBJECT_TYPE = 'role';
/** 使用者集合「角色的持有者」：`role:<id>#holder`。 */
export const ROLE_HOLDER_RELATION = 'holder';
export const USER_SUBJECT_TYPE = 'user';
/** 萬用字元：所有使用者（`user:*`）。 */
export const WILDCARD_SUBJECT_ID = '*';

/** `role:<roleId>#holder@user:<userId>`：使用者持有角色（取代 user_roles）。 */
export function roleHolderTuple(
  roleId: string,
  userId: string,
  createdBy: string | null = null,
): RelationTupleInsert {
  return {
    objectType: ROLE_OBJECT_TYPE,
    objectId: roleId,
    relation: ROLE_HOLDER_RELATION,
    subjectType: USER_SUBJECT_TYPE,
    subjectId: userId,
    subjectRelation: '',
    createdBy,
  };
}

/** `tenant:self#<key>@role:<roleId>#holder`：角色帶的權限鍵（取代 role_permissions）。 */
export function rolePermissionTuple(
  roleId: string,
  key: string,
  createdBy: string | null = null,
): RelationTupleInsert {
  return {
    objectType: TENANT_OBJECT_TYPE,
    objectId: TENANT_OBJECT_ID,
    relation: key,
    subjectType: ROLE_OBJECT_TYPE,
    subjectId: roleId,
    subjectRelation: ROLE_HOLDER_RELATION,
    createdBy,
  };
}

/** `tenant:self#superAdmin@role:<roleId>#holder`：super-admin 角色（它沒有任何權限鍵的邊）。 */
export function superAdminTuple(roleId: string): RelationTupleInsert {
  return rolePermissionTuple(roleId, SUPER_ADMIN_RELATION);
}

/** 條件函式也套得到同一張表的別名（`alias(relationTuples, …)`，自我 join 時）。 */
export interface TupleColumns {
  objectType: AnyPgColumn;
  objectId: AnyPgColumn;
  relation: AnyPgColumn;
  subjectType: AnyPgColumn;
  subjectRelation: AnyPgColumn;
}

/** 「使用者持有角色」的邊：`object_id` 是角色、`subject_id` 是使用者。 */
export function isRoleHolderTuple(t: TupleColumns = relationTuples): SQL {
  return and(
    eq(t.objectType, ROLE_OBJECT_TYPE),
    eq(t.relation, ROLE_HOLDER_RELATION),
    eq(t.subjectType, USER_SUBJECT_TYPE),
    eq(t.subjectRelation, ''),
  ) as SQL;
}

/** 「角色帶的權限鍵」的邊：`subject_id` 是角色、`relation` 是權限鍵（不含 superAdmin）。 */
export function isRolePermissionTuple(t: TupleColumns = relationTuples): SQL {
  return and(
    eq(t.objectType, TENANT_OBJECT_TYPE),
    eq(t.objectId, TENANT_OBJECT_ID),
    eq(t.subjectType, ROLE_OBJECT_TYPE),
    eq(t.subjectRelation, ROLE_HOLDER_RELATION),
    ne(t.relation, SUPER_ADMIN_RELATION),
  ) as SQL;
}
