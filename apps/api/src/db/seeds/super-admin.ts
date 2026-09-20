import { and, eq, isNull, sql } from 'drizzle-orm';

import { hashPassword, generateStrongPassword } from '@/modules/auth/password';

import type { ScriptDatabase } from '../client';
import { auditLogs, roles, userRoles, users } from '../schema';

const SUPER_ADMIN_SLUG = 'super-admin';

/** ④ 初始超級管理員：只在不存在任何 super-admin 時建立。 */
export async function seedSuperAdmin(db: ScriptDatabase): Promise<void> {
  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.slug, SUPER_ADMIN_SLUG), isNull(roles.deletedAt)))
    .limit(1);
  if (!role) throw new Error('super-admin 角色不存在，請先執行角色 seed');

  const [holder] = await db
    .select({ id: users.id })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.roleId, role.id), isNull(users.deletedAt)))
    .limit(1);

  if (holder) {
    console.info('super-admin 已存在，略過建立');
    return;
  }

  const email = process.env.SUPER_ADMIN_EMAIL;
  if (!email) throw new Error('SUPER_ADMIN_EMAIL 未設定');
  const provided = process.env.SUPER_ADMIN_PASSWORD;
  const password = provided && provided.length >= 12 ? provided : generateStrongPassword(24);

  // production 使用隨機密碼時，帳號建立為 pending，必須走啟用流程
  const status = !provided && process.env.NODE_ENV === 'production' ? 'pending' : 'active';

  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email,
        displayName: 'Super Admin',
        passwordHash: await hashPassword(password),
        status,
      })
      .returning();
    if (!user) throw new Error('建立 super-admin 失敗');

    await tx.insert(userRoles).values({ userId: user.id, roleId: role.id, grantedBy: null });
    await tx.insert(auditLogs).values({
      action: 'system.bootstrap',
      actorId: null,
      actorEmail: 'system',
      resourceType: 'user',
      resourceId: user.id,
      resourceName: email,
      result: 'success',
      metadata: { reason: 'initial super admin created' },
    });
  });

  if (!provided) {
    // ★ 只印這一次，之後無從取得
    console.warn(
      `\n=== 初始超級管理員 ===\n  帳號：${email}\n  密碼：${password}\n  狀態：${status}\n  請立即登入並變更密碼。\n`,
    );
  } else {
    console.info(`super-admin 已建立：${email}`);
  }
}

export async function countSuperAdmins(db: ScriptDatabase): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(roles.slug, SUPER_ADMIN_SLUG), isNull(users.deletedAt)));
  return row?.total ?? 0;
}
