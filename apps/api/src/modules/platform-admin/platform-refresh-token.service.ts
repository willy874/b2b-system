import { Injectable } from '@nestjs/common';

import type { PlatformRefreshTokenRow } from '@/db/platform/schema';
import type { RevokedReason } from '@/db/schema';
import { rotateRefreshToken } from '@/modules/credential/refresh-rotation';
import type { RefreshTokenRecord, RotationOptions } from '@/modules/credential/refresh-rotation';
import { sha256 } from '@/modules/credential/token-hash';

import { PlatformRefreshTokenRepository } from './platform-refresh-token.repository';
import type { IssuePlatformRefreshTokenInput } from './platform-refresh-token.repository';

/**
 * 平台管理者的 refresh token（平台 DB，docs/architecture/05-tenancy.md §10.2 D5）：規則與租戶的
 * `RefreshTokenService` 相同。平台 DB 的表都歸這個模組；登入流程（`AuthModule` 的 `PlatformAuthService`）經過這裡。
 */
@Injectable()
export class PlatformRefreshTokenService {
  constructor(private readonly repo: PlatformRefreshTokenRepository) {}

  issue(input: IssuePlatformRefreshTokenInput): Promise<{ raw: string }> {
    return this.repo.issue(input);
  }

  rotate<TSubject>(
    rawToken: string,
    options: RotationOptions<TSubject>,
  ): Promise<{ row: RefreshTokenRecord; subject: TSubject; raw: string; expiresAt: Date }> {
    return rotateRefreshToken(this.repo.store, rawToken, options);
  }

  /** 撤銷這張 token 所在的整條家族（登出）；回傳那張 token，找不到時回傳 `undefined`。 */
  async revokeFamilyOf(
    rawToken: string,
    reason: RevokedReason,
  ): Promise<PlatformRefreshTokenRow | undefined> {
    const row = await this.repo.findByHash(sha256(rawToken));
    if (row) await this.repo.revokeFamily(row.familyId, reason);
    return row;
  }

  /** 單一登出：撤銷同一個 IdP session 的家族。 */
  revokeByIdpSession(idpSessionUid: string, reason: RevokedReason): Promise<void> {
    return this.repo.revokeByIdpSession(idpSessionUid, reason);
  }
}
