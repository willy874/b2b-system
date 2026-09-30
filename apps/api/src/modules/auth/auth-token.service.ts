import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import { SettingService } from '@/core/settings';
import type { AuthTokenPurpose, AuthTokenRow, RevokedReason } from '@/db/schema';
import { authTokens } from '@/db/schema';

import { ACTIVATION_TTL_HOURS_SETTING, PASSWORD_RESET_TTL_HOURS_SETTING } from './auth.settings';
import { RefreshTokenRepository } from './refresh-token.repository';
import { sha256 } from './token-hash';

/**
 * 啟用 / 密碼重設 token。
 * 獨立成一個 service 讓 `UserModule` 可以發啟用信而不必依賴 `AuthModule`
 * （否則 AuthModule → UserModule → AuthModule 形成循環）。
 */
@Injectable()
export class AuthTokenService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly settings: SettingService,
  ) {}

  /** 撤銷使用者所有未撤銷的 refresh token（停用、刪除帳號時用）。 */
  async revokeAllRefreshTokens(userId: string, reason: RevokedReason, tx?: DbOrTx): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId, reason, tx);
  }

  /**
   * 發新 token 前先作廢同使用者同用途的既有未使用 token。
   * 只由寄信的背景工作呼叫（`AuthMailJobs`）：寄出當下才簽發，原文不進工作資料。
   */
  async issue(
    userId: string,
    purpose: AuthTokenPurpose,
    tx?: DbOrTx,
  ): Promise<{ raw: string; expiresAt: Date; validHours: number }> {
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
    // 有效時數是租戶的設定；信裡寫的時數與實際到期時間出自同一個值
    const validHours = await this.settings.get(
      purpose === 'activation' ? ACTIVATION_TTL_HOURS_SETTING : PASSWORD_RESET_TTL_HOURS_SETTING,
    );
    const expiresAt = new Date(Date.now() + validHours * 60 * 60 * 1000);

    await db.insert(authTokens).values({ userId, purpose, tokenHash: sha256(raw), expiresAt });
    // 原文只回給寄信的工作放進連結，不寫日誌（docs/adr/0017-mail-delivery.md D7）
    return { raw, expiresAt, validHours };
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
