import { and, eq, isNull, sql } from 'drizzle-orm';

import type { ScriptDatabase } from '../connect';
import {
  auditLogs,
  isRoleHolderTuple,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
} from '../schema';

const SUPER_ADMIN_SLUG = 'super-admin';

/**
 * 佈建新租戶時的第一位管理員（docs/architecture/05-tenancy.md §10.2 D12）：super-admin、`pending`、沒有密碼，
 * 由啟用信設定密碼。冪等：已經有 super-admin 時不再建立，回傳這個 email 的帳號（佈建重試時用來補寄啟用信）。
 */
export async function seedTenantAdmin(
  db: ScriptDatabase,
  input: { email: string; displayName: string },
): Promise<{ id: string; status: string } | undefined> {
  const findByEmail = async () => {
    const [row] = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
      .limit(1);
    return row;
  };
  if ((await countSuperAdmins(db)) > 0) return findByEmail();

  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.slug, SUPER_ADMIN_SLUG), isNull(roles.deletedAt)))
    .limit(1);
  if (!role) throw new Error('super-admin 角色不存在，請先執行角色 seed');

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: input.email, displayName: input.displayName, status: 'pending' })
      .returning({ id: users.id, status: users.status });
    if (!user) throw new Error('建立租戶的第一位管理員失敗');
    await tx.insert(relationTuples).values(roleHolderTuple(role.id, user.id));
    await tx.insert(auditLogs).values({
      action: 'system.bootstrap',
      actorId: null,
      actorEmail: 'system',
      resourceType: 'user',
      resourceId: user.id,
      resourceName: input.email,
      result: 'success',
      metadata: { reason: 'tenant provisioned' },
    });
    return user;
  });
}

export async function countSuperAdmins(db: ScriptDatabase): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(relationTuples)
    .innerJoin(roles, eq(sql`${roles.id}::text`, relationTuples.objectId))
    .innerJoin(users, eq(sql`${users.id}::text`, relationTuples.subjectId))
    .where(and(isRoleHolderTuple(), eq(roles.slug, SUPER_ADMIN_SLUG), isNull(users.deletedAt)));
  return row?.total ?? 0;
}
