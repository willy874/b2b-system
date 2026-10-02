import { and, eq, sql } from 'drizzle-orm';

import { files, isRoleHolderTuple, notDeleted, relationTuples, roles, users } from '@/db/schema';

import type { TestDatabase } from './db';

// 樂觀鎖的 `version` 與 `expectedRoleIds` 是必填（docs/architecture/backend/14-revisions.md §9.2 D4 的 R1b）：
// 測的不是衝突本身時，先讀目前的值再送出，等同「編輯開始時看到的」。

/** 使用者目前的 `version`（`PATCH /users/:id` 的本體要帶）。 */
export async function userVersion(db: TestDatabase, id: string): Promise<number> {
  const [row] = await db.select({ version: users.version }).from(users).where(eq(users.id, id));
  if (!row) throw new Error(`找不到使用者 ${id}`);
  return row.version;
}

/** 角色目前的 `version`（`PATCH /roles/:id`、還原到某一版的本體要帶）。 */
export async function roleVersion(db: TestDatabase, id: string): Promise<number> {
  const [row] = await db.select({ version: roles.version }).from(roles).where(eq(roles.id, id));
  if (!row) throw new Error(`找不到角色 ${id}`);
  return row.version;
}

/** 檔案目前的 `version`（`PATCH /files/:id` 的本體要帶）。 */
export async function fileVersion(db: TestDatabase, id: string): Promise<number> {
  const [row] = await db.select({ version: files.version }).from(files).where(eq(files.id, id));
  if (!row) throw new Error(`找不到檔案 ${id}`);
  return row.version;
}

/**
 * 使用者目前持有、而且未刪除的角色 id（`PUT /users/:id/roles` 的 `expectedRoleIds`）。
 * 已刪除角色的持有者邊會保留（docs/architecture/backend/14-revisions.md §9.2 D2），伺服器比對時不算在內，這裡也一樣排除。
 */
export async function currentRoleIds(db: TestDatabase, userId: string): Promise<string[]> {
  const rows = await db
    .select({ roleId: roles.id })
    .from(relationTuples)
    .innerJoin(roles, eq(sql`${roles.id}::text`, relationTuples.objectId))
    .where(and(isRoleHolderTuple(), eq(relationTuples.subjectId, userId), notDeleted(roles)));
  return rows.map((row) => row.roleId);
}
