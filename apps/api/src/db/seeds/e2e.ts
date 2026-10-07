import { and, eq, isNull } from 'drizzle-orm';

import { hashPassword } from '@/modules/credential/password';

import type { ScriptDatabase } from '../client';
import {
  assertDisposableScriptTargets,
  createPlatformScriptClient,
  forEachScriptTenant,
  loadScriptEnv,
  seedTenantCode,
} from '../client';
import { relationTuples, roleHolderTuple, roles, users } from '../schema';
import { runSeed } from './index';
import { upsertPlatformAdmin } from './platform-admin';

export const E2E_PASSWORD = 'E2E!Password123';

/** apps/platform 的平台管理者（docs/architecture/05-tenancy.md §10.2 D5）；與租戶的帳號是兩份資料。 */
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
  // 專門給群組的測試用：經群組取得、失去角色，不能和其他測試共用（tests/group.spec.ts）
  { email: 'e2e-groupme@dev.local', displayName: 'E2E Group Target', role: 'member' },
  // 專門給改密碼、忘記密碼的測試用：密碼會被改掉（tests/account.spec.ts）
  { email: 'e2e-passwordme@dev.local', displayName: 'E2E Password Target', role: 'member' },
  // 專門給公告的收件人用：收到的通知與其他測試分開（tests/announcement.spec.ts）
  { email: 'e2e-announceme@dev.local', displayName: 'E2E Announce Target', role: 'member' },
  // 專門給資料夾分享的測試用：被授予、撤銷資料夾的存取（tests/file.spec.ts）
  { email: 'e2e-shareme@dev.local', displayName: 'E2E Share Target', role: 'member' },
  // 專門給 MFA 的測試用：驗證器 App、Email 驗證碼、政策要求的首次設定（tests/mfa.spec.ts；驗證方式會被設定與重設）
  { email: 'e2e-mfame@dev.local', displayName: 'E2E MFA TOTP', role: 'member' },
  { email: 'e2e-mfamail@dev.local', displayName: 'E2E MFA Email', role: 'member' },
  { email: 'e2e-mfapolicy@dev.local', displayName: 'E2E MFA Policy', role: 'member' },
] as const;

export async function seedE2eData(db: ScriptDatabase): Promise<void> {
  // 第二道防線：seedE2e() 已在寫入平台管理者之前檢查過目標
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

/**
 * `db:seed:e2e`：E2E 的平台管理者與租戶帳號。防呆在任何寫入之前——平台管理者的帳密是公開的，
 * 先寫入再被擋下等於在正式環境留下一位已知密碼的 super-admin（`script-guard.ts`）。
 */
export async function seedE2e(): Promise<void> {
  const code = seedTenantCode();
  await assertDisposableScriptTargets('db:seed:e2e', { code });
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
    { code },
  );
}

async function main(): Promise<void> {
  loadScriptEnv();
  await seedE2e();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
