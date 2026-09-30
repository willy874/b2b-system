import { and, eq, isNull } from 'drizzle-orm';

import { hashPassword } from '@/modules/credential/password';

import type { ScriptDatabase } from '../client';
import {
  createPlatformScriptClient,
  forEachScriptTenant,
  loadScriptEnv,
  seedTenantCode,
} from '../client';
import { relationTuples, roleHolderTuple, roles, users } from '../schema';
import { runSeed } from './index';
import { upsertPlatformAdmin } from './platform-admin';

export const E2E_PASSWORD = 'E2E!Password123';

/** apps/auth 的平台管理者（docs/adr/0020-physical-tenant-isolation.md D5）；與租戶的帳號是兩份資料。 */
export const E2E_PLATFORM_ADMIN = 'e2e-platform@dev.local';

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
  // 專門給「權限在使用中被撤銷」的測試用：角色會被整批改寫，不能和其他測試共用
  { email: 'e2e-revokeme@dev.local', displayName: 'E2E Revoke Target', role: 'member' },
  // 專門給「角色刪除 → 還原」的測試用：持有的自訂角色會被刪掉再還原（tests/trash-and-revisions.spec.ts）
  { email: 'e2e-roleholder@dev.local', displayName: 'E2E Role Holder', role: 'member' },
  // 專門給站內通知的測試用：角色會被增減（user.rolesChanged），未讀數要能精確斷言，不能和其他測試共用（tests/notification.spec.ts）
  { email: 'e2e-notifyme@dev.local', displayName: 'E2E Notify Target', role: 'member' },
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

    await db.insert(relationTuples).values(roleHolderTuple(role.id, userId)).onConflictDoNothing();
  }

  console.info(`E2E 帳號已就緒（密碼統一為 ${E2E_PASSWORD}）：`);
  for (const account of E2E_ACCOUNTS) console.info(`  ${account.email} → ${account.role}`);
}

async function main(): Promise<void> {
  loadScriptEnv();
  const platform = createPlatformScriptClient();
  try {
    await upsertPlatformAdmin(platform.db, {
      email: E2E_PLATFORM_ADMIN,
      displayName: 'E2E Platform Admin',
      password: E2E_PASSWORD,
    });
    console.info(`E2E 平台管理者已就緒：${E2E_PLATFORM_ADMIN}`);
  } finally {
    await platform.client.end();
  }
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
