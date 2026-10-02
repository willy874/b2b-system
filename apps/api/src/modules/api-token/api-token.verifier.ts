import { createHash, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AccessTokenVerifier, parseToken } from '@/common/auth';
import type { PermissionKey } from '@/common/types';
import { ApiTokenCacheService } from '@/core/cache';
import type { CachedApiToken, CachedUser } from '@/core/cache';
import type { ErrorCode } from '@/core/errors';
import { currentTenant } from '@/core/tenant';
import { isPermissionKey, permissionClosure } from '@/db/seeds/permissions';

import { ApiTokenRepository } from './api-token.repository';

export type ApiTokenErrorCode = Extract<
  ErrorCode,
  'AUTH_TOKEN_INVALID' | 'AUTH_TOKEN_STALE' | 'AUTH_ACCOUNT_DISABLED' | 'AUTH_API_TOKEN_EXPIRED'
>;

export interface VerifiedApiToken {
  id: string;
  /** 限縮後的權限鍵（含依賴樹的閉包）；undefined＝跟著帳號。 */
  scopes?: ReadonlySet<PermissionKey>;
  expiresAt: Date;
}

export type ApiTokenVerifyResult =
  | { ok: true; user: CachedUser; token: VerifiedApiToken }
  | { ok: false; code: ApiTokenErrorCode };

function sameHash(secret: string, expectedHex: string): boolean {
  const actual = createHash('sha256').update(secret).digest();
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * API token 的判定規則（docs/architecture/06-external-api.md §9.2 D5、D7、D17），只在對外 API 使用：
 * 格式 → 租戶相符 → 以 id 找（快取 10 秒）→ 比對雜湊 → 未撤銷、未過期 → 帳號仍有效且 `token_version` 沒變。
 *
 * 呼叫前請求已由 token 的租戶代碼進入那個租戶（`TokenTenantMiddleware`）；這裡再確認一次代碼相符。
 * 不拋例外，由 guard 決定回應。
 */
@Injectable()
export class ApiTokenVerifier {
  constructor(
    private readonly repo: ApiTokenRepository,
    private readonly cache: ApiTokenCacheService,
    private readonly accounts: AccessTokenVerifier,
  ) {}

  async verify(raw: string | undefined): Promise<ApiTokenVerifyResult> {
    const parsed = raw ? parseToken(raw) : null;
    const tenant = currentTenant();
    if (!parsed || !tenant || tenant.code !== parsed.tenantCode) {
      return { ok: false, code: 'AUTH_TOKEN_INVALID' };
    }
    const token = await this.load(parsed.tokenId);
    // 找不到、雜湊不符、已撤銷都是同一個錯誤：不透露 token id 是否存在
    if (!token || !sameHash(parsed.secret, token.secretHash) || token.revokedAt) {
      return { ok: false, code: 'AUTH_TOKEN_INVALID' };
    }
    if (token.expiresAt <= new Date()) return { ok: false, code: 'AUTH_API_TOKEN_EXPIRED' };

    // 帳號的狀態與 token_version 走使用者快取（停用、改密碼會廣播失效）
    const account = await this.accounts.checkUser(token.userId, token.accountVersion);
    if (!account.ok) return account;
    return {
      ok: true,
      user: account.user,
      token: {
        id: token.id,
        expiresAt: token.expiresAt,
        ...(token.scopes
          ? { scopes: permissionClosure(token.scopes.filter(isPermissionKey)) }
          : {}),
      },
    };
  }

  private async load(tokenId: string): Promise<CachedApiToken | undefined> {
    const cached = this.cache.get(tokenId);
    if (cached) return cached;
    const ticket = this.cache.ticket();
    const row = await this.repo.findForVerification(tokenId);
    if (!row) return undefined;
    const token: CachedApiToken = {
      id: row.id,
      userId: row.userId,
      secretHash: row.secretHash,
      scopes: row.scopes,
      accountVersion: row.accountVersion,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
    this.cache.set(token, ticket);
    return token;
  }
}
