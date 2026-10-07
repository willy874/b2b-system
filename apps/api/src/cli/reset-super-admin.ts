import { and, eq, sql } from 'drizzle-orm';

import {
  createPlatformScriptClient,
  createScriptClient,
  listScriptTenants,
  loadScriptEnv,
} from '@/db/client';
import type { PlatformScriptDatabase, ScriptDatabase } from '@/db/client';
import { platformAdmins, platformAuditLogs } from '@/db/platform/schema';
import {
  auditLogs,
  isHumanUser,
  isRoleHolderTuple,
  notDeleted,
  relationTuples,
  roles,
  users,
} from '@/db/schema';
import { confirmArgument, remoteRejection } from '@/db/script-guard';
import { issueAuthToken } from '@/modules/credential/auth-token-issue';
import { issuePlatformAuthToken } from '@/modules/platform-admin/platform-auth-token-issue';

/**
 * 災難復原：super-admin 忘記密碼、「忘記密碼」的信又寄不到時（信箱失效、SMTP 不通），
 * 由有資料庫存取權的維運人員簽發一次性連結（docs/architecture/iam/05-bootstrap.md §7）。
 *
 *   pnpm --filter @b2b-system/api cli:reset-super-admin --tenant <租戶代碼> --email <email>
 *   pnpm --filter @b2b-system/api cli:reset-super-admin --platform --email <email>
 *
 * 不提供後門 API、不直接改密碼：簽發與一般流程相同的 token（`issueAuthToken`／`issuePlatformAuthToken`），
 * 印出連結，由本人在 apps/platform 設定新密碼。還沒啟用（`pending`）的帳號簽發啟用連結。
 * 要動到不在本機的資料庫時加 `--confirm <平台 database 名稱>`（`script-guard.ts` 的 `remoteRejection`）；
 * 正式環境本來就是它的使用場景，所以不像 `db:reset` 那樣拒絕 production。
 */

/** 連結的有效時間：印在終端機上，比寄信的連結（租戶設定，預設 24 小時）短。 */
export const RESET_LINK_TTL_SECONDS = 60 * 60;

/** 寫進稽核的 action（租戶的 `audit_logs` 或平台的 `platform_audit_logs`）。 */
export const SUPER_ADMIN_RESET_ACTION = 'system.super_admin_reset_requested';

const USAGE =
  '用法：cli:reset-super-admin (--tenant <租戶代碼> | --platform) --email <email> ' +
  '[--confirm <平台 database 名稱>]';

const SUPER_ADMIN_SLUG = 'super-admin';

export interface ResetSuperAdminOptions {
  /** 租戶代碼；`'platform'` 是平台管理者（apps/platform 的帳號）。 */
  target: { tenant: string } | 'platform';
  email: string;
  /** `--confirm` 的值：不在本機的資料庫要等於平台 database 名稱。 */
  confirm?: string;
}

export interface ResetSuperAdminResult {
  /** `password_reset`：重設密碼；`activation`：還沒啟用，設定密碼。 */
  purpose: 'password_reset' | 'activation';
  link: string;
  expiresAt: Date;
}

function argumentOf(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

/** 解析指令列；用法不對時拋錯（訊息帶用法）。 */
export function parseResetSuperAdminArgs(argv: readonly string[]): ResetSuperAdminOptions {
  const email = argumentOf(argv, '--email')?.trim();
  const tenant = argumentOf(argv, '--tenant')?.trim();
  const platform = argv.includes('--platform');
  if (!email) throw new Error(`缺少 --email。${USAGE}`);
  if (platform === Boolean(tenant)) {
    throw new Error(`--tenant 與 --platform 要指定其中一個。${USAGE}`);
  }
  return {
    target: tenant ? { tenant } : 'platform',
    email,
    confirm: confirmArgument(argv),
  };
}

/** apps/platform 的網址；正式環境沒設定就拋錯（印出 localhost 的連結只會誤導）。 */
function platformAppUrl(env: NodeJS.ProcessEnv): string {
  const url = env.PLATFORM_APP_URL;
  if (!url && env.NODE_ENV === 'production') {
    throw new Error('PLATFORM_APP_URL 未設定：連結要指向 apps/platform');
  }
  return (url || 'http://localhost:5175').replace(/\/+$/, '');
}

/** 與 `MailService.accountLink` 相同的組法：租戶的連結帶 `?tenant=`，平台管理者的不帶。 */
function accountLink(
  base: string,
  purpose: ResetSuperAdminResult['purpose'],
  token: string,
  tenantCode?: string,
): string {
  const link = new URL(`${base}${purpose === 'activation' ? '/setup' : '/reset-password'}`);
  link.searchParams.set('token', token);
  if (tenantCode) link.searchParams.set('tenant', tenantCode);
  return link.toString();
}

function assertGuarded(
  platformUrl: string,
  tenantUrls: readonly string[],
  confirm: string | undefined,
): void {
  const rejection = remoteRejection(
    { script: 'cli:reset-super-admin', platformUrl, tenantUrls },
    confirm,
  );
  if (rejection) throw new Error(rejection);
}

/** 簽發連結並寫稽核；不印東西（`main` 負責輸出）。 */
export async function resetSuperAdmin(
  options: ResetSuperAdminOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResetSuperAdminResult> {
  const platformUrl = env.PLATFORM_DATABASE_URL;
  if (!platformUrl) throw new Error('PLATFORM_DATABASE_URL 未設定');
  const base = platformAppUrl(env);
  const platform = createPlatformScriptClient(platformUrl);
  try {
    if (options.target === 'platform') {
      assertGuarded(platformUrl, [], options.confirm);
      return await resetPlatformSuperAdmin(platform.db, options.email, base);
    }
    const [tenant] = await listScriptTenants(platform.db, { code: options.target.tenant });
    if (!tenant) throw new Error(`找不到租戶 ${options.target.tenant}`);
    if (tenant.status !== 'active') {
      throw new Error(`租戶 ${tenant.code} 的狀態是 ${tenant.status}：只有 active 的租戶能登入`);
    }
    assertGuarded(platformUrl, [tenant.databaseUrl], options.confirm);
    const { client, db } = createScriptClient(tenant.databaseUrl);
    try {
      return await resetTenantSuperAdmin(db, tenant.code, options.email, base);
    } finally {
      await client.end();
    }
  } finally {
    await platform.client.end();
  }
}

async function resetTenantSuperAdmin(
  db: ScriptDatabase,
  tenantCode: string,
  email: string,
  base: string,
): Promise<ResetSuperAdminResult> {
  const [user] = await db
    .select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(and(eq(users.email, email), notDeleted(users), isHumanUser()))
    .limit(1);
  if (!user) throw new Error(`租戶 ${tenantCode} 沒有 ${email} 這個帳號（或已刪除）`);
  // super-admin 只能直接持有（群組不能持有 super-admin：GROUP_SUPER_ADMIN_FORBIDDEN）
  const [held] = await db
    .select({ id: roles.id })
    .from(relationTuples)
    .innerJoin(roles, eq(sql`${roles.id}::text`, relationTuples.objectId))
    .where(
      and(
        isRoleHolderTuple(),
        eq(relationTuples.subjectId, user.id),
        eq(roles.slug, SUPER_ADMIN_SLUG),
        notDeleted(roles),
      ),
    )
    .limit(1);
  if (!held) {
    throw new Error(`${email} 沒有持有 super-admin：其他帳號請由 super-admin 在後台重設`);
  }
  if (user.status === 'inactive') {
    throw new Error(`${email} 已停用：重設密碼也不能登入，先由其他 super-admin 啟用`);
  }
  const purpose = user.status === 'pending' ? 'activation' : 'password_reset';
  const { raw, expiresAt } = await db.transaction(async (tx) => {
    const issued = await issueAuthToken(tx, {
      userId: user.id,
      purpose,
      validSeconds: RESET_LINK_TTL_SECONDS,
    });
    await tx.insert(auditLogs).values({
      action: SUPER_ADMIN_RESET_ACTION,
      actorId: null,
      actorEmail: 'system',
      resourceType: 'user',
      resourceId: user.id,
      resourceName: user.email,
      result: 'success',
      metadata: { purpose, expiresAt: issued.expiresAt.toISOString(), via: 'cli' },
    });
    return issued;
  });
  return { purpose, link: accountLink(base, purpose, raw, tenantCode), expiresAt };
}

async function resetPlatformSuperAdmin(
  db: PlatformScriptDatabase,
  email: string,
  base: string,
): Promise<ResetSuperAdminResult> {
  const [admin] = await db
    .select({
      id: platformAdmins.id,
      email: platformAdmins.email,
      role: platformAdmins.role,
      status: platformAdmins.status,
    })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.email, email), notDeleted(platformAdmins)))
    .limit(1);
  if (!admin) throw new Error(`平台沒有 ${email} 這位管理者（或已刪除）`);
  if (admin.role !== SUPER_ADMIN_SLUG) {
    throw new Error(`${email} 是 ${admin.role}：其他管理者請由平台的 super-admin 重設`);
  }
  if (admin.status === 'inactive') {
    throw new Error(`${email} 已停用：重設密碼也不能登入，先由其他 super-admin 啟用`);
  }
  const purpose = admin.status === 'pending' ? 'activation' : 'password_reset';
  const { raw, expiresAt } = await db.transaction(async (tx) => {
    const issued = await issuePlatformAuthToken(tx, {
      adminId: admin.id,
      purpose,
      validSeconds: RESET_LINK_TTL_SECONDS,
    });
    await tx.insert(platformAuditLogs).values({
      action: SUPER_ADMIN_RESET_ACTION,
      actorEmail: 'system',
      resourceType: 'platformAdmin',
      resourceId: admin.id,
      result: 'success',
      metadata: { email: admin.email, purpose, expiresAt: issued.expiresAt.toISOString() },
    });
    return issued;
  });
  return { purpose, link: accountLink(base, purpose, raw), expiresAt };
}

async function main(): Promise<void> {
  loadScriptEnv();
  const options = parseResetSuperAdminArgs(process.argv.slice(2));
  const { purpose, link, expiresAt } = await resetSuperAdmin(options);
  const minutes = Math.round((expiresAt.getTime() - Date.now()) / 60_000);
  console.warn(
    `\n=== ${purpose === 'activation' ? '啟用' : '重設密碼'}連結 ===\n` +
      `  帳號：${options.email}（${options.target === 'platform' ? '平台管理者' : `租戶 ${options.target.tenant}`}）\n` +
      `  以下連結 ${minutes} 分鐘內有效、只能用一次；交給本人在瀏覽器開啟設定新密碼：\n  ${link}\n` +
      `  已寫入稽核（${SUPER_ADMIN_RESET_ACTION}）。重新執行會作廢這個連結、換發新的。\n`,
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
