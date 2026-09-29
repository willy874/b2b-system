import { and, eq, isNull } from 'drizzle-orm';

import type { ScriptDatabase } from '../client';
import { auditLogs, roles, workspaceMemberRoles, workspaceMembers, workspaces } from '../schema';

export const DEFAULT_WORKSPACE_SLUG = 'default';

/**
 * ⑤ 一個工作區都沒有時建立預設工作區（docs/adr/0018-workspace-tenancy.md D18）：
 * 新環境的檔案管理器才有地方用。升級的環境由 migration 建立，這裡不會再建。
 */
export async function seedDefaultWorkspace(db: ScriptDatabase): Promise<void> {
  const [existing] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(isNull(workspaces.deletedAt))
    .limit(1);
  if (existing) {
    console.info('工作區已存在，略過建立預設工作區');
    return;
  }

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(workspaces)
      .values({ slug: DEFAULT_WORKSPACE_SLUG, name: '預設工作區' })
      .returning();
    if (!created) throw new Error('建立預設工作區失敗');
    await tx.insert(auditLogs).values({
      action: 'workspace.create',
      actorId: null,
      actorEmail: 'system',
      resourceType: 'workspace',
      resourceId: created.id,
      resourceName: created.name,
      result: 'success',
      metadata: { reason: 'default workspace created' },
    });
  });
  console.info('預設工作區已建立');
}

/**
 * 把使用者加入工作區並給一個工作區角色（冪等）。給 dev / e2e seed 用；
 * 正式流程經 `modules/workspace` 才會有稽核與反提權檢查。
 */
export async function seedWorkspaceMember(
  db: ScriptDatabase,
  workspaceSlug: string,
  userId: string,
  roleSlug: string,
): Promise<void> {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.slug, workspaceSlug), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!workspace) throw new Error(`工作區不存在：${workspaceSlug}（請先跑 db:seed）`);
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.slug, roleSlug), eq(roles.scope, 'workspace'), isNull(roles.deletedAt)))
    .limit(1);
  if (!role) throw new Error(`工作區角色不存在：${roleSlug}（請先跑 db:seed）`);

  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId })
    .onConflictDoNothing();
  await db
    .insert(workspaceMemberRoles)
    .values({ workspaceId: workspace.id, userId, roleId: role.id })
    .onConflictDoNothing();
}

/** 建立工作區（已存在則沿用），回傳 id。給 dev / e2e seed 用。 */
export async function seedWorkspace(
  db: ScriptDatabase,
  slug: string,
  name: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(workspaces).values({ slug, name }).returning();
  if (!created) throw new Error(`建立工作區失敗：${slug}`);
  return created.id;
}
