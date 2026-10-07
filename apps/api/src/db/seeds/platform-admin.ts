import { isNull } from 'drizzle-orm';

import { generateStrongPassword, hashPassword } from '@/modules/credential/password';
import { issuePlatformAuthToken } from '@/modules/platform-admin/platform-auth-token-issue';

import type { PlatformScriptDatabase } from '../connect';
import { platformAdmins, platformAuditLogs } from '../platform/schema';
import type { PlatformAdminRole } from '../platform/schema';
import { assertSeedPassword } from './seed-password';

/**
 * production 印出的設定連結的有效時間。連結出現在部署日誌裡，所以比啟用信（24 小時）短；
 * 過期或遺失時重新執行 `db:seed`（重新部署）會換發新的連結。
 */
const BOOTSTRAP_SETUP_TTL_SECONDS = 60 * 60;

type PlatformScriptDbOrTx =
  | PlatformScriptDatabase
  | Parameters<Parameters<PlatformScriptDatabase['transaction']>[0]>[0];

export interface PlatformAdminSeedResult {
  /** production 的第一位管理者（`pending`）設定密碼用的一次性連結。 */
  setupLink?: string;
}

/**
 * 第一位平台管理者（docs/architecture/05-tenancy.md §10.2 D5）：平台 DB 還沒有任何管理者時，
 * 依 `PLATFORM_ADMIN_EMAIL` 建立。沒設定就略過（這時沒有人能登入 apps/platform 的租戶管理）。
 *
 * - 提供的 `PLATFORM_ADMIN_PASSWORD` 不符合密碼政策時失敗，不靜默換成隨機密碼。
 * - production 沒有提供密碼：建成 `pending`，**不印密碼**，改印一次性、短效的設定連結（apps/platform 的 `/setup`）；
 *   之後的部署只要這位管理者還是唯一一位、而且還沒設定密碼，就換發新的連結（docs/architecture/iam/05-bootstrap.md §5.1）。
 * - 開發環境沒有提供密碼：隨機產生、直接啟用，只印這一次。
 */
export async function seedPlatformAdmin(
  db: PlatformScriptDatabase,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlatformAdminSeedResult> {
  const email = env.PLATFORM_ADMIN_EMAIL;
  const production = env.NODE_ENV === 'production';
  const admins = await db
    .select({ id: platformAdmins.id, email: platformAdmins.email, status: platformAdmins.status })
    .from(platformAdmins)
    .where(isNull(platformAdmins.deletedAt));
  if (admins.length > 0) {
    const [only] = admins;
    const awaitingSetup =
      production &&
      admins.length === 1 &&
      only?.status === 'pending' &&
      only.email.toLowerCase() === email?.toLowerCase();
    if (!only || !awaitingSetup) {
      console.info('平台管理者已存在，略過建立');
      return {};
    }
    const setupLink = await db.transaction((tx) => issueSetupLink(tx, only.id, env));
    printSetupLink(only.email, setupLink);
    return { setupLink };
  }

  if (!email) {
    console.warn('PLATFORM_ADMIN_EMAIL 未設定：沒有建立平台管理者');
    return {};
  }
  const provided = env.PLATFORM_ADMIN_PASSWORD || undefined;
  if (provided) assertSeedPassword(provided, email, 'PLATFORM_ADMIN_PASSWORD');

  if (production && !provided) {
    const setupLink = await db.transaction(async (tx) => {
      const [admin] = await tx
        .insert(platformAdmins)
        .values({ email, displayName: 'Platform Admin', role: 'super-admin', status: 'pending' })
        .returning({ id: platformAdmins.id });
      if (!admin) throw new Error('建立平台管理者失敗');
      await recordBootstrap(tx, email);
      return issueSetupLink(tx, admin.id, env);
    });
    printSetupLink(email, setupLink);
    return { setupLink };
  }

  const password = provided ?? generateStrongPassword(24);
  await upsertPlatformAdmin(db, { email, displayName: 'Platform Admin', password });
  await recordBootstrap(db, email);
  if (provided) console.info(`平台管理者已建立：${email}`);
  else console.warn(`\n=== 初始平台管理者 ===\n  帳號：${email}\n  密碼：${password}\n`);
  return {};
}

async function recordBootstrap(db: PlatformScriptDbOrTx, email: string): Promise<void> {
  await db.insert(platformAuditLogs).values({
    action: 'system.bootstrap',
    actorEmail: 'system',
    resourceType: 'platformAdmin',
    resourceId: email,
    result: 'success',
    metadata: { reason: 'initial platform admin created' },
  });
}

/** 簽發啟用用的 token（先作廢同一位管理者還沒用掉的），回傳 apps/platform 的設定連結。 */
async function issueSetupLink(
  db: PlatformScriptDbOrTx,
  adminId: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const base = env.PLATFORM_APP_URL;
  if (!base) {
    throw new Error('PLATFORM_APP_URL 未設定：production 的第一位平台管理者要以設定連結啟用');
  }
  const { raw } = await issuePlatformAuthToken(db, {
    adminId,
    purpose: 'activation',
    validSeconds: BOOTSTRAP_SETUP_TTL_SECONDS,
  });
  // 與 MailService.accountLink 相同的組法；平台管理者的連結不帶 ?tenant=
  const link = new URL(`${base}/setup`);
  link.searchParams.set('token', raw);
  return link.toString();
}

function printSetupLink(email: string, link: string): void {
  console.warn(
    `\n=== 初始平台管理者 ===\n  帳號：${email}（pending）\n` +
      `  以下連結設定密碼，${BOOTSTRAP_SETUP_TTL_SECONDS / 60} 分鐘內有效、只能用一次：\n  ${link}\n` +
      '  過期時重新執行 db:seed（重新部署）會換發新的連結。\n',
  );
}

/** 建立或重設（密碼、狀態）一位平台管理者；E2E 的固定帳號也用它。 */
export async function upsertPlatformAdmin(
  db: PlatformScriptDatabase,
  input: { email: string; displayName: string; password: string; role?: PlatformAdminRole },
): Promise<void> {
  const passwordHash = await hashPassword(input.password);
  // 沒指定就是 super-admin：seed 建立的是第一位管理者，要能管理租戶與其他管理者
  const role = input.role ?? 'super-admin';
  await db
    .insert(platformAdmins)
    .values({ email: input.email, displayName: input.displayName, passwordHash, role })
    .onConflictDoUpdate({
      target: platformAdmins.email,
      targetWhere: isNull(platformAdmins.deletedAt),
      set: { passwordHash, role, status: 'active', failedLoginCount: 0, lockedUntil: null },
    });
}
