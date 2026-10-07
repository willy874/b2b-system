import { and, eq, isNull, sql } from 'drizzle-orm';

import type { DbOrTx } from '@/core/database';
import { issueAuthToken } from '@/modules/credential/auth-token-issue';
import { hashPassword, generateStrongPassword } from '@/modules/credential/password';

import type { ScriptDatabase } from '../connect';
import {
  auditLogs,
  isRoleHolderTuple,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
} from '../schema';
import { assertSeedPassword } from './seed-password';

const SUPER_ADMIN_SLUG = 'super-admin';

/** 第一位 super-admin 的啟用連結有效時間：只印在部署日誌上，比寄信的連結短（同平台管理者）。 */
export const BOOTSTRAP_ACTIVATION_TTL_SECONDS = 60 * 60;

export interface SuperAdminSeedResult {
  /** production 沒有提供密碼時印出的一次性啟用連結（測試用；日誌上的就是它）。 */
  activationLink?: string;
}

/**
 * ④ 初始超級管理員：只在不存在任何 super-admin 時建立（docs/architecture/iam/05-bootstrap.md §5）。
 *
 * - 有 `SUPER_ADMIN_PASSWORD`：以它建成 active（要符合密碼政策）。
 * - 沒有、非 production：隨機密碼、active，印出一次（開發用）。
 * - 沒有、production：建成 `pending`，**不印密碼**，改印一次性的啟用連結（apps/platform 的 `/setup?tenant=`，1 小時）。
 *   它還是唯一一位、而且還沒啟用時，下一次 `db:seed`（重新部署）換發新的連結、舊的作廢。
 */
export async function seedSuperAdmin(
  db: ScriptDatabase,
  tenantCode: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SuperAdminSeedResult> {
  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.slug, SUPER_ADMIN_SLUG), isNull(roles.deletedAt)))
    .limit(1);
  if (!role) throw new Error('super-admin 角色不存在，請先執行角色 seed');

  const email = env.SUPER_ADMIN_EMAIL;
  const production = env.NODE_ENV === 'production';
  const holders = await db
    .select({ id: users.id, email: users.email, status: users.status })
    .from(relationTuples)
    .innerJoin(users, eq(sql`${users.id}::text`, relationTuples.subjectId))
    .where(and(isRoleHolderTuple(), eq(relationTuples.objectId, role.id), isNull(users.deletedAt)));

  if (holders.length > 0) {
    const [only] = holders;
    const awaitingActivation =
      production &&
      holders.length === 1 &&
      only?.status === 'pending' &&
      only.email.toLowerCase() === email?.toLowerCase();
    if (!only || !awaitingActivation) {
      console.info('super-admin 已存在，略過建立');
      return {};
    }
    const activationLink = await db.transaction((tx) =>
      issueActivationLink(tx, only.id, tenantCode, env),
    );
    printActivationLink(only.email, activationLink);
    return { activationLink };
  }

  if (!email) throw new Error('SUPER_ADMIN_EMAIL 未設定');
  const provided = env.SUPER_ADMIN_PASSWORD || undefined;
  if (provided) assertSeedPassword(provided, email, 'SUPER_ADMIN_PASSWORD');
  // production 沒有提供密碼：pending，密碼是沒有人知道的隨機值，由啟用連結設定
  const password = provided ?? generateStrongPassword(24);
  const status = !provided && production ? 'pending' : 'active';

  const activationLink = await db.transaction(async (tx) => {
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

    await tx.insert(relationTuples).values(roleHolderTuple(role.id, user.id));
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
    return status === 'pending' ? issueActivationLink(tx, user.id, tenantCode, env) : undefined;
  });

  if (activationLink) {
    printActivationLink(email, activationLink);
    return { activationLink };
  }
  if (!provided) {
    // ★ 只印這一次，之後無從取得（只有非 production 會走到這裡）
    console.warn(
      `\n=== 初始超級管理員 ===\n  帳號：${email}\n  密碼：${password}\n  請立即登入並變更密碼。\n`,
    );
  } else {
    console.info(`super-admin 已建立：${email}`);
  }
  return {};
}

/** 簽發啟用 token（先作廢同一位使用者還沒用掉的），回傳 apps/platform 的設定連結（與 `MailService.accountLink` 相同的組法）。 */
async function issueActivationLink(
  tx: DbOrTx,
  userId: string,
  tenantCode: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const base = env.PLATFORM_APP_URL?.replace(/\/+$/, '');
  if (!base) {
    throw new Error(
      'PLATFORM_APP_URL 未設定：production 的第一位 super-admin 要以啟用連結設定密碼',
    );
  }
  const { raw } = await issueAuthToken(tx, {
    userId,
    purpose: 'activation',
    validSeconds: BOOTSTRAP_ACTIVATION_TTL_SECONDS,
  });
  const link = new URL(`${base}/setup`);
  link.searchParams.set('token', raw);
  link.searchParams.set('tenant', tenantCode);
  return link.toString();
}

function printActivationLink(email: string, link: string): void {
  console.warn(
    `\n=== 初始超級管理員 ===\n  帳號：${email}（pending）\n` +
      `  以下連結設定密碼，${BOOTSTRAP_ACTIVATION_TTL_SECONDS / 60} 分鐘內有效、只能用一次：\n  ${link}\n` +
      '  過期時重新執行 db:seed（重新部署）會換發新的連結。\n',
  );
}
