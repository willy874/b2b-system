import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { AuthTokenPurpose, AuthTokenRow } from '@/db/schema';
import { authTokens } from '@/db/schema';

export const ACTIVATION_TTL_SECONDS = 24 * 60 * 60; // 24 小時
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1 小時

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * 啟用 / 密碼重設 token。
 * 獨立成一個 service 讓 `UserModule` 可以發啟用信而不必依賴 `AuthModule`
 * （否則 AuthModule → UserModule → AuthModule 形成循環）。
 */
@Injectable()
export class AuthTokenService {
  private readonly logger = new Logger(AuthTokenService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** 發新 token 前先作廢同使用者同用途的既有未使用 token。 */
  async issue(
    userId: string,
    purpose: AuthTokenPurpose,
    tx?: DbOrTx,
  ): Promise<{ raw: string; expiresAt: Date }> {
    const db = tx ?? this.db;
    await db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
        ),
      );

    const raw = randomBytes(32).toString('base64url');
    const ttl = purpose === 'activation' ? ACTIVATION_TTL_SECONDS : PASSWORD_RESET_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    await db.insert(authTokens).values({ userId, purpose, tokenHash: sha256(raw), expiresAt });

    // Phase 0 沒有郵件基礎設施：把連結寫進日誌，由維運人員轉交。
    this.logger.warn(
      `[${purpose}] token for user ${userId}: ${raw}（有效至 ${expiresAt.toISOString()}）`,
    );
    return { raw, expiresAt };
  }

  async findUsable(raw: string, purpose: AuthTokenPurpose): Promise<AuthTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.tokenHash, sha256(raw)), eq(authTokens.purpose, purpose)))
      .limit(1);
    if (!row) return undefined;
    if (row.usedAt) return undefined;
    if (row.expiresAt.getTime() < Date.now()) return undefined;
    return row;
  }

  async markUsed(id: string, tx?: DbOrTx): Promise<void> {
    const db = tx ?? this.db;
    await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, id));
  }
}
