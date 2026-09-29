import { and, eq, isNull } from 'drizzle-orm';

import { hashPassword } from '@/modules/auth/password';

import type { ScriptDatabase } from '../client';
import { forEachScriptTenant, loadScriptEnv, seedTenantCode } from '../client';
import { roles, userRoles, users } from '../schema';
import { runSeed } from './index';

export const E2E_PASSWORD = 'E2E!Password123';

/** 固定帳號，讓 E2E 的起點永遠一致（docs/architecture/frontend/10-testing.md §4.3）。 */
export const E2E_ACCOUNTS = [
  { email: 'e2e-superadmin@dev.local', displayName: 'E2E Super Admin', role: 'super-admin' },
  { email: 'e2e-admin@dev.local', displayName: 'E2E Admin', role: 'admin' },
  { email: 'e2e-auditor@dev.local', displayName: 'E2E Auditor', role: 'auditor' },
  { email: 'e2e-member@dev.local', displayName: 'E2E Member', role: 'member' },
  // 專門給「連續失敗 → 鎖定」的測試用，避免污染其他帳號
  { email: 'e2e-lockme@dev.local', displayName: 'E2E Lock Target', role: 'member' },
  // 專門給「被停用 → 下一次操作被登出」的測試用
  { email: 'e2e-disableme@dev.local', displayName: 'E2E Disable Target', role: 'member' },
] as const;

export async function seedE2eData(db: ScriptDatabase): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:seed:e2e 不可在 production 執行');
  }

  const passwordHash = await hashPassword(E2E_PASSWORD);

  for (const account of E2E_ACCOUNTS) {
    const [role] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.slug, account.role), isNull(roles.deletedAt)))
      .limit(1);
    if (!role) throw new Error(`角色不存在：${account.role}（請先跑 db:seed）`);

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, account.email), isNull(users.deletedAt)))
      .limit(1);

    const userId =
      existing?.id ??
      (
        await db
          .insert(users)
          .values({
            email: account.email,
            displayName: account.displayName,
            passwordHash,
            status: 'active',
          })
          .returning({ id: users.id })
      )[0]?.id;

    if (!userId) throw new Error(`建立 E2E 帳號失敗：${account.email}`);

    await db.insert(userRoles).values({ userId, roleId: role.id }).onConflictDoNothing();
  }

  console.info(`E2E 帳號已就緒（密碼統一為 ${E2E_PASSWORD}）：`);
  for (const account of E2E_ACCOUNTS) console.info(`  ${account.email} → ${account.role}`);
}

async function main(): Promise<void> {
  loadScriptEnv();
  await forEachScriptTenant(
    async (db) => {
      await runSeed(db);
      await seedE2eData(db);
    },
    { code: seedTenantCode() },
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
