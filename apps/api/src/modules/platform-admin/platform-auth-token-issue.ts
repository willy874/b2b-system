import { randomBytes } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import type { PlatformDbOrTx } from '@/core/database';
import { platformAuthTokens } from '@/db/platform/schema';
import type { PlatformAuthTokenPurpose } from '@/db/platform/schema';
import { sha256 } from '@/modules/credential/token-hash';

/**
 * 簽發平台管理者的啟用／重設 token（`platform_auth_tokens`）：先作廢同一位管理者同用途還沒用掉的，再存新 token 的雜湊；
 * 回傳原文（只放進連結）。規則同租戶的 `issueAuthToken()`。
 * 不經 DI 的純函式：寄信的背景工作（`PlatformAuthTokenRepository.issue`）、第一位管理者的 seed、災難復原的 CLI 共用。
 */
export async function issuePlatformAuthToken(
  db: PlatformDbOrTx,
  input: { adminId: string; purpose: PlatformAuthTokenPurpose; validSeconds: number },
): Promise<{ raw: string; expiresAt: Date }> {
  await db
    .update(platformAuthTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(platformAuthTokens.adminId, input.adminId),
        eq(platformAuthTokens.purpose, input.purpose),
        isNull(platformAuthTokens.usedAt),
      ),
    );
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + input.validSeconds * 1000);
  await db.insert(platformAuthTokens).values({
    adminId: input.adminId,
    purpose: input.purpose,
    tokenHash: sha256(raw),
    expiresAt,
  });
  return { raw, expiresAt };
}
