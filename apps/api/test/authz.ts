import { and, eq } from 'drizzle-orm';

import { isRoleHolderTuple, relationTuples } from '@/db/schema';

import type { TestDatabase } from './db';

/** 使用者持有的角色 id（`role:<id>#holder@user:<userId>` 的邊）。 */
export async function heldRoleIds(db: TestDatabase, userId: string): Promise<string[]> {
  const rows = await db
    .select({ roleId: relationTuples.objectId })
    .from(relationTuples)
    .where(and(isRoleHolderTuple(), eq(relationTuples.subjectId, userId)));
  return rows.map((row) => row.roleId);
}
