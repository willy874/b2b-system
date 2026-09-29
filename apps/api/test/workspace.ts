import { and, eq, inArray } from 'drizzle-orm';

import { roles, userRoles, workspaceMemberRoles, workspaceMembers, workspaces } from '@/db/schema';

import type { TestDatabase } from './db';

/** seed 建立的預設工作區（docs/adr/0018-workspace-tenancy.md D18）。 */
export async function defaultWorkspaceId(db: TestDatabase): Promise<string> {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.slug, 'default'));
  if (!row) throw new Error('沒有預設工作區（請先 runSeed）');
  return row.id;
}

/** 工作區範圍 API 的路徑前綴。 */
export function workspacePath(workspaceId: string): string {
  return `/workspaces/${workspaceId}`;
}

export async function createWorkspace(db: TestDatabase, slug: string): Promise<string> {
  const [row] = await db.insert(workspaces).values({ slug, name: slug }).returning();
  if (!row) throw new Error('建立工作區失敗');
  return row.id;
}

/**
 * 依角色的範圍指派：全域角色進 `user_roles`，工作區角色進 `workspaceId` 的成員角色。
 * `workspaceId` 有值時一律加入成員（即使沒有工作區角色）。
 */
export async function assignRoles(
  db: TestDatabase,
  userId: string,
  roleIds: readonly string[],
  workspaceId?: string,
): Promise<void> {
  const rows =
    roleIds.length > 0
      ? await db
          .select()
          .from(roles)
          .where(inArray(roles.id, [...roleIds]))
      : [];
  const platform = rows.filter((role) => role.scope === 'platform');
  const scoped = rows.filter((role) => role.scope === 'workspace');
  if (platform.length > 0) {
    await db.insert(userRoles).values(platform.map((role) => ({ userId, roleId: role.id })));
  }
  if (!workspaceId) {
    if (scoped.length > 0) throw new Error('工作區角色需要指定工作區');
    return;
  }
  await db.insert(workspaceMembers).values({ workspaceId, userId }).onConflictDoNothing();
  if (scoped.length > 0) {
    await db
      .insert(workspaceMemberRoles)
      .values(scoped.map((role) => ({ workspaceId, userId, roleId: role.id })))
      .onConflictDoNothing();
  }
}

export async function roleIdOf(db: TestDatabase, slug: string): Promise<string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, slug));
  if (!role) throw new Error(`沒有角色 ${slug}`);
  return role.id;
}

export async function isMember(
  db: TestDatabase,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return Boolean(row);
}
