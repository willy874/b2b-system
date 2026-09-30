import { Injectable } from '@nestjs/common';

import type { DbOrTx } from '@/core/database';
import type { RefreshTokenRow, RevokedReason } from '@/db/schema';

import { rotateRefreshToken } from './refresh-rotation';
import type { RefreshTokenRecord, RotationOptions } from './refresh-rotation';
import { RefreshTokenRepository } from './refresh-token.repository';
import type { IssueRefreshTokenInput } from './refresh-token.repository';
import { sha256 } from './token-hash';

/**
 * 目前租戶的 refresh token（app session，docs/architecture/backend/04-auth.md §2）。
 * 登入流程（`AuthModule`）、帳號管理（`UserModule`）與租戶停用（`TenantModule`）都經過這裡，
 * 不直接碰 `refresh_tokens`。
 */
@Injectable()
export class RefreshTokenService {
  constructor(private readonly repo: RefreshTokenRepository) {}

  /** 發一張 refresh token；沒帶 `familyId` 就是一次新的登入（新家族）。 */
  issue(
    input: IssueRefreshTokenInput,
    tx?: DbOrTx,
  ): Promise<{ raw: string; row: RefreshTokenRow }> {
    return this.repo.issue(input, tx);
  }

  /** 輪替：一次性使用、重用偵測、家族的絕對壽命與重送寬限期（`rotateRefreshToken`）。 */
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
  ): Promise<RefreshTokenRow | undefined> {
    const row = await this.repo.findByHash(sha256(rawToken));
    if (row) await this.repo.revokeFamily(row.familyId, reason);
    return row;
  }

  /** 撤銷這個人所有未撤銷的 refresh token（停用、刪除帳號、重設密碼）。 */
  revokeAllForUser(userId: string, reason: RevokedReason, tx?: DbOrTx): Promise<void> {
    return this.repo.revokeAllForUser(userId, reason, tx);
  }

  /** 單一登出：撤銷同一個 IdP session 的家族；回傳受影響的使用者。 */
  revokeByIdpSession(idpSessionUid: string, reason: RevokedReason): Promise<string[]> {
    return this.repo.revokeByIdpSession(idpSessionUid, reason);
  }

  /** 撤銷目前租戶的所有 session（平台管理者停用或刪除租戶，docs/adr/0020-physical-tenant-isolation.md D13）。 */
  revokeAll(reason: RevokedReason): Promise<void> {
    return this.repo.revokeAll(reason);
  }
}
