import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase, PlatformDbOrTx } from '@/core/database';
import type { PlatformAuthTokenPurpose } from '@/db/platform/schema';
import { platformAuthTokens } from '@/db/platform/schema';
import { sha256 } from '@/modules/credential/token-hash';

import {
  PLATFORM_ACTIVATION_TTL_SECONDS,
  PLATFORM_PASSWORD_RESET_TTL_SECONDS,
} from './platform-admin.constants';

/** 平台管理者的啟用與重設密碼 token（平台 DB）；規則同租戶的 `AuthTokenService`。 */
@Injectable()
export class PlatformAuthTokenRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  /** 發新 token 前先作廢同一位管理者同用途的舊 token。只由寄信的背景工作呼叫。 */
  async issue(adminId: string, purpose: PlatformAuthTokenPurpose): Promise<{ raw: string }> {
    await this.db
      .update(platformAuthTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(platformAuthTokens.adminId, adminId),
          eq(platformAuthTokens.purpose, purpose),
          isNull(platformAuthTokens.usedAt),
        ),
      );
    const raw = randomBytes(32).toString('base64url');
    const ttl =
      purpose === 'activation'
        ? PLATFORM_ACTIVATION_TTL_SECONDS
        : PLATFORM_PASSWORD_RESET_TTL_SECONDS;
    await this.db.insert(platformAuthTokens).values({
      adminId,
      purpose,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + ttl * 1000),
    });
    return { raw };
  }

  /** 未使用、未過期的 token；否則 undefined。 */
  async findUsable(raw: string, purpose: PlatformAuthTokenPurpose) {
    const [row] = await this.db
      .select()
      .from(platformAuthTokens)
      .where(
        and(eq(platformAuthTokens.tokenHash, sha256(raw)), eq(platformAuthTokens.purpose, purpose)),
      )
      .limit(1);
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return undefined;
    return row;
  }

  async markUsed(id: string, tx?: PlatformDbOrTx): Promise<void> {
    await (tx ?? this.db)
      .update(platformAuthTokens)
      .set({ usedAt: new Date() })
      .where(eq(platformAuthTokens.id, id));
  }
}
