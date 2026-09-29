import { isNull, sql } from 'drizzle-orm';

import { generateStrongPassword, hashPassword } from '@/modules/auth/password';

import type { PlatformScriptDatabase } from '../client';
import { platformAdmins, platformAuditLogs } from '../platform/schema';
import type { PlatformAdminRole } from '../platform/schema';

/**
 * 第一位平台管理者（docs/adr/0020-physical-tenant-isolation.md D5）：平台 DB 還沒有任何管理者時，
 * 依 `PLATFORM_ADMIN_EMAIL` 建立。沒設定就略過（這時沒有人能登入 apps/auth 的租戶管理）。
 * 密碼留空時隨機產生並只印這一次。
 */
export async function seedPlatformAdmin(db: PlatformScriptDatabase): Promise<void> {
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(platformAdmins)
    .where(isNull(platformAdmins.deletedAt));
  if (total > 0) {
    console.info('平台管理者已存在，略過建立');
    return;
  }
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  if (!email) {
    console.warn('PLATFORM_ADMIN_EMAIL 未設定：沒有建立平台管理者');
    return;
  }
  const provided = process.env.PLATFORM_ADMIN_PASSWORD;
  const password = provided && provided.length >= 12 ? provided : generateStrongPassword(24);
  await upsertPlatformAdmin(db, { email, displayName: 'Platform Admin', password });
  await db.insert(platformAuditLogs).values({
    action: 'system.bootstrap',
    actorEmail: 'system',
    resourceType: 'platformAdmin',
    resourceId: email,
    result: 'success',
    metadata: { reason: 'initial platform admin created' },
  });
  if (provided) console.info(`平台管理者已建立：${email}`);
  else console.warn(`\n=== 初始平台管理者 ===\n  帳號：${email}\n  密碼：${password}\n`);
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
