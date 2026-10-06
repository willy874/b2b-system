import { randomBytes } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import type { DbOrTx } from '@/core/database';
import { authTokens } from '@/db/schema';
import type { AuthTokenPurpose } from '@/db/schema';

import { sha256 } from './token-hash';

export interface IssuedAuthToken {
  /** 原文：只放進連結，不寫日誌、不落地（docs/architecture/backend/11-mail.md §9.2 D7）。 */
  raw: string;
  expiresAt: Date;
}

/**
 * 簽發啟用／重設 token 的規則（`auth_tokens`）：先作廢同一位使用者同用途還沒用掉的，再存新 token 的雜湊。
 * 不經 DI 的純函式：寄信的背景工作（`AuthTokenService.issue`）與災難復原的 CLI（`cli/reset-super-admin.ts`）共用，
 * 兩條路簽出的 token 一樣能走 `POST /auth/setup`／`POST /auth/reset-password`。
 */
export async function issueAuthToken(
  db: DbOrTx,
  input: { userId: string; purpose: AuthTokenPurpose; validSeconds: number },
): Promise<IssuedAuthToken> {
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, input.userId),
        eq(authTokens.purpose, input.purpose),
        isNull(authTokens.usedAt),
      ),
    );
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + input.validSeconds * 1000);
  await db.insert(authTokens).values({
    userId: input.userId,
    purpose: input.purpose,
    tokenHash: sha256(raw),
    expiresAt,
  });
  return { raw, expiresAt };
}
