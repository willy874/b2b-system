import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage, normalizeIp } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { currentTenant } from '@/core/tenant';

import { AccessTokenVerifier } from '../auth/access-token.verifier';
import {
  accountOf,
  RATE_LIMIT_POLICY,
  RATE_LIMIT_WINDOW_MS,
  rateLimitBucketsOf,
  rateLimitSettingsOf,
} from '../rate-limit';
import type { RateLimitPolicy, RateLimitSettings, RateLimitSubject } from '../rate-limit';
import { extractBearer } from './jwt-auth.guard';

/**
 * `@SkipThrottle()`（`@nestjs/throttler`）寫的 metadata key：`THROTTLER:SKIP` ＋ throttler 名稱。
 * 套件沒有匯出這個常數；沿用它讓既有的 `@SkipThrottle()` 照常生效。
 */
const SKIP_THROTTLE_METADATA = 'THROTTLER:SKIPdefault';

/**
 * 全域的速率限制（取代 `ThrottlerGuard`；規則見 `common/rate-limit.ts`）。
 *
 * 在 `JwtAuthGuard` 之前執行（沒帶或帶錯 token 的請求也要被限流），所以這裡自己驗簽取出使用者：
 * 只驗簽與網域，不查 DB——使用者被停用之類的判斷留給 `JwtAuthGuard`。計數存在 `@nestjs/throttler`
 * 的記憶體儲存（單一執行個體；多實例的共享計數見 docs/features/multi-instance.md）。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly settings: RateLimitSettings;
  private readonly refreshCookieName: string;

  constructor(
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
    config: ConfigService<Env, true>,
  ) {
    this.settings = rateLimitSettingsOf({
      DEFAULT_RATE_LIMIT: config.get('DEFAULT_RATE_LIMIT', { infer: true }),
      ANONYMOUS_RATE_LIMIT: config.get('ANONYMOUS_RATE_LIMIT', { infer: true }),
      AUTH_RATE_LIMIT: config.get('AUTH_RATE_LIMIT', { infer: true }),
      AUTH_IP_RATE_LIMIT: config.get('AUTH_IP_RATE_LIMIT', { infer: true }),
      REFRESH_RATE_LIMIT: config.get('REFRESH_RATE_LIMIT', { infer: true }),
      REFRESH_IP_RATE_LIMIT: config.get('REFRESH_IP_RATE_LIMIT', { infer: true }),
    });
    this.refreshCookieName = config.get('REFRESH_COOKIE_NAME', { infer: true });
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // WebSocket 的限流在 gateway（handshake 每 IP、每連線訊息數；backend/08-realtime.md §11）
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_THROTTLE_METADATA, targets)) return true;

    const policy = this.reflector.getAllAndOverride<RateLimitPolicy | undefined>(
      RATE_LIMIT_POLICY,
      targets,
    );
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const subject = await this.subjectOf(req, policy);

    for (const bucket of rateLimitBucketsOf(policy, subject, this.settings)) {
      // oxlint-disable-next-line no-await-in-loop -- 桶數最多兩個；超過一個就不必再計下一個
      const record = await this.storage.increment(
        `${bucket.name}:${bucket.key}`,
        RATE_LIMIT_WINDOW_MS,
        bucket.limit,
        RATE_LIMIT_WINDOW_MS,
        bucket.name,
      );
      if (record.isBlocked) {
        const retryAfterSeconds = Math.max(1, record.timeToBlockExpire);
        http.getResponse<Response>().setHeader('Retry-After', String(retryAfterSeconds));
        throw new AppException('RATE_LIMITED', { retryAfterSeconds });
      }
    }
    return true;
  }

  private async subjectOf(
    req: Request,
    policy: RateLimitPolicy | undefined,
  ): Promise<RateLimitSubject> {
    const ip = normalizeIp(req.ip ?? req.socket.remoteAddress ?? 'unknown');
    switch (policy) {
      case 'auth':
      case 'authMail':
        return { ip, account: accountOf(req.body, currentTenant()?.id ?? 'platform') };
      case 'refresh': {
        const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
        const raw = cookies?.[this.refreshCookieName];
        // 只存雜湊：計數的 key 會留在記憶體裡
        return { ip, session: raw ? createHash('sha256').update(raw).digest('hex') : undefined };
      }
      default:
        return { ip, principal: await this.principalOf(req) };
    }
  }

  private async principalOf(req: Request): Promise<string | undefined> {
    const payload = await this.verifier.verifyClaims(extractBearer(req.headers.authorization));
    if (!payload) return undefined;
    const tenant = currentTenant();
    return tenant ? `t:${tenant.id}:${payload.sub}` : `p:${payload.sub}`;
  }
}
