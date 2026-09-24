import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';

import { UserCacheService } from '@/core/cache';
import type { CachedUser } from '@/core/cache';
import type { Env } from '@/core/config';
import { DRIZZLE } from '@/core/database';
import type { Database } from '@/core/database';
import type { ErrorCode } from '@/core/errors';
import { users } from '@/db/schema';

export interface AccessTokenPayload {
  sub: string;
  ver: number;
  jti: string;
}

/** 驗簽後的 payload：`exp` 由 JWT 函式庫補上（秒）。 */
export interface VerifiedAccessTokenPayload extends AccessTokenPayload {
  exp: number;
}

/** 驗證失敗的原因；與 HTTP 回應的錯誤碼同一套。 */
export type AccessTokenErrorCode = Extract<
  ErrorCode,
  'AUTH_TOKEN_INVALID' | 'AUTH_TOKEN_STALE' | 'AUTH_ACCOUNT_DISABLED'
>;

export type UserCheckResult =
  | { ok: true; user: CachedUser }
  | { ok: false; code: AccessTokenErrorCode };

export type AccessTokenVerifyResult =
  | { ok: true; user: CachedUser; payload: VerifiedAccessTokenPayload }
  | { ok: false; code: AccessTokenErrorCode };

/**
 * Access token 的唯一判定規則：驗簽 → `UserCacheService`（沒有就查 DB）→
 * `deletedAt` / `status` / `token_version`。
 * `JwtAuthGuard`、WebSocket handshake、`WsAuthGuard` 共用，避免判定分歧
 * （docs/architecture/backend/08-realtime.md §3.2）。
 */
@Injectable()
export class AccessTokenVerifier {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly userCache: UserCacheService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  /** 驗證 token 並回傳使用者；不拋例外，由呼叫端決定要回 HTTP 錯誤或 connect_error。 */
  async verify(token: string | undefined): Promise<AccessTokenVerifyResult> {
    if (!token) return { ok: false, code: 'AUTH_TOKEN_INVALID' };

    let payload: VerifiedAccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<VerifiedAccessTokenPayload>(token, {
        secret: this.config.get('JWT_SECRET', { infer: true }),
      });
    } catch {
      return { ok: false, code: 'AUTH_TOKEN_INVALID' };
    }

    const checked = await this.checkUser(payload.sub, payload.ver);
    return checked.ok ? { ok: true, user: checked.user, payload } : checked;
  }

  /** 已驗過簽的身分（例：socket 上的 `userId` ＋ `tokenVersion`）是否仍有效。 */
  async checkUser(userId: string, tokenVersion: number): Promise<UserCheckResult> {
    const user = this.userCache.get(userId) ?? (await this.loadUser(userId));
    if (!user || user.deletedAt) return { ok: false, code: 'AUTH_TOKEN_INVALID' };
    if (user.status !== 'active') return { ok: false, code: 'AUTH_ACCOUNT_DISABLED' };
    if (user.tokenVersion !== tokenVersion) return { ok: false, code: 'AUTH_TOKEN_STALE' };
    return { ok: true, user };
  }

  private async loadUser(userId: string): Promise<CachedUser | undefined> {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        tokenVersion: users.tokenVersion,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return undefined;
    this.userCache.set(row);
    return row;
  }
}
