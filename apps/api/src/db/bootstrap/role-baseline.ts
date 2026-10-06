import { toRoleRevision } from '@/modules/role/role-revision';

import type { ScriptDatabase } from '../connect';
import { revisions } from '../schema';

/**
 * 新建立的角色的第 1 版（docs/architecture/backend/14-revisions.md §4.2）：與 migration 0014 的基準版本同一個形狀，
 * actor 為 null（系統）。只在建立時寫；已存在的角色由 migration 補上或已有版本。
 */
export async function recordRoleBaseline(
  db: ScriptDatabase,
  role: { id: string; name: string; description: string | null },
  permissionKeys: readonly string[],
): Promise<void> {
  await db
    .insert(revisions)
    .values({
      resourceType: 'role',
      resourceId: role.id,
      version: 1,
      snapshot: toRoleRevision(role, permissionKeys),
      actorId: null,
    })
    .onConflictDoNothing();
}
