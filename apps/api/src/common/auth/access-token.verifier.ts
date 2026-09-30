import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';

import { UserCacheService } from '@/core/cache';
import type { CachedUser } from '@/core/cache';
import type { Env } from '@/core/config';
import { PLATFORM_DB, TENANT_DB } from '@/core/database';
import type { Database, PlatformDatabase } from '@/core/database';
import type { ErrorCode } from '@/core/errors';
import { currentTenant } from '@/core/tenant';
import { platformAdmins } from '@/db/platform/schema';
import { users } from '@/db/schema';

export interface AccessTokenPayload {
  sub: string;
  ver: number;
  jti: string;
  /** 簽發時的租戶（docs/adr/0020-physical-tenant-isolation.md D10）：拿到別的租戶的網域就無效。平台管理者沒有。 */
  tid?: string;
  /** 平台管理者的 token（apps/auth，D5）；只在不屬於任何租戶的網域有效。 */
  realm?: 'platform';
  /** 經 SSO 登入時的 IdP session（docs/adr/0019-sso-identity-platform.md D5）；密碼直接登入時沒有。 */
  sid?: string;
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
 * Access token 的唯一判定規則：驗簽 → 租戶相符 → `UserCacheService`（沒有就查 DB）→
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
    @Inject(TENANT_DB) private readonly db: Database,
    @Inject(PLATFORM_DB) private readonly platformDb: PlatformDatabase,
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

    // 身分範圍由網域決定：租戶網域只接受那個租戶簽的 token（使用者 id 只在自己的租戶 DB 有意義）；
    // 不屬於任何租戶的網域（apps/auth）只接受平台管理者的 token
    const tenant = currentTenant();
    const matches = tenant
      ? payload.tid === tenant.id
      : payload.realm === 'platform' && !payload.tid;
    if (!matches) return { ok: false, code: 'AUTH_TOKEN_INVALID' };

    const checked = tenant
      ? await this.checkUser(payload.sub, payload.ver)
      : await this.checkIdentity(payload.sub, payload.ver, () =>
          this.loadPlatformAdmin(payload.sub),
        );
    return checked.ok ? { ok: true, user: checked.user, payload } : checked;
  }

  /** 已驗過簽的身分（例：socket 上的 `userId` ＋ `tokenVersion`）是否仍有效。 */
  async checkUser(userId: string, tokenVersion: number): Promise<UserCheckResult> {
    return this.checkIdentity(userId, tokenVersion, () => this.loadUser(userId));
  }

  private async checkIdentity(
    userId: string,
    tokenVersion: number,
    load: () => Promise<CachedUser | undefined>,
  ): Promise<UserCheckResult> {
    // 快取以租戶區分；平台管理者（沒有租戶脈絡）自成一組
    const user = this.userCache.get(userId) ?? (await load());
    if (!user || user.deletedAt) return { ok: false, code: 'AUTH_TOKEN_INVALID' };
    if (user.status !== 'active') return { ok: false, code: 'AUTH_ACCOUNT_DISABLED' };
    if (user.tokenVersion !== tokenVersion) return { ok: false, code: 'AUTH_TOKEN_STALE' };
    return { ok: true, user };
  }

  private async loadPlatformAdmin(adminId: string): Promise<CachedUser | undefined> {
    const [row] = await this.platformDb
      .select({
        id: platformAdmins.id,
        email: platformAdmins.email,
        status: platformAdmins.status,
        tokenVersion: platformAdmins.tokenVersion,
        deletedAt: platformAdmins.deletedAt,
      })
      .from(platformAdmins)
      .where(eq(platformAdmins.id, adminId))
      .limit(1);
    if (!row) return undefined;
    this.userCache.set(row);
    return row;
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
