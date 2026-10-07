import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { cidrMatcher, ipPrefixOf, RateLimitStore } from '@/core/rate-limit';
import {
  currentTenant,
  RATE_LIMIT_AUTH_PER_MINUTE_PARAM,
  RATE_LIMIT_TRUSTED_CIDRS_PARAM,
  resolveTenantFeatureParam,
} from '@/core/tenant';

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
 * 只驗簽與網域，不查 DB——使用者被停用之類的判斷留給 `JwtAuthGuard`。計數存在 `RateLimitStore`
 * （目前是程序內的記憶體；多實例的共享計數見 docs/features/multi-instance.md，換實作即可）。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly settings: RateLimitSettings;
  private readonly refreshCookieName: string;
  /** 監控探針、內部服務：豁免以 IP 計的桶（不豁免任何帳號層級的限制）。 */
  private readonly isExempt: (ip: string | undefined) => boolean;

  constructor(
    private readonly store: RateLimitStore,
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
    config: ConfigService<Env, true>,
  ) {
    this.settings = rateLimitSettingsOf({
      DEFAULT_RATE_LIMIT: config.get('DEFAULT_RATE_LIMIT', { infer: true }),
      ANONYMOUS_RATE_LIMIT: config.get('ANONYMOUS_RATE_LIMIT', { infer: true }),
      AUTH_RATE_LIMIT: config.get('AUTH_RATE_LIMIT', { infer: true }),
      AUTH_IP_RATE_LIMIT: config.get('AUTH_IP_RATE_LIMIT', { infer: true }),
      AUTH_TENANT_RATE_LIMIT: config.get('AUTH_TENANT_RATE_LIMIT', { infer: true }),
      REFRESH_RATE_LIMIT: config.get('REFRESH_RATE_LIMIT', { infer: true }),
      REFRESH_IP_RATE_LIMIT: config.get('REFRESH_IP_RATE_LIMIT', { infer: true }),
    });
    this.refreshCookieName = config.get('REFRESH_COOKIE_NAME', { infer: true });
    this.isExempt = cidrMatcher(config.get('RATE_LIMIT_EXEMPT_CIDRS', { infer: true }));
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
      // 豁免的來源只略過以 IP 計的桶（帳號、身分、租戶、session 照常計）
      if (subject.exempt && bucket.key === subject.ip) continue;
      // oxlint-disable-next-line no-await-in-loop -- 桶數最多三個；超過一個就不必再計下一個
      const record = await this.store.hit(`${bucket.name}:${bucket.key}`, RATE_LIMIT_WINDOW_MS);
      if (record.count > bucket.limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - Date.now()) / 1000));
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
    const rawIp = req.ip ?? req.socket.remoteAddress;
    const ip = ipPrefixOf(rawIp);
    const exempt = this.isExempt(rawIp);
    switch (policy) {
      case 'auth':
      case 'authMail': {
        const tenant = currentTenant();
        const account = accountOf(req.body, tenant?.id ?? 'platform');
        // 租戶的覆寫（feature 參數）；沒覆寫時用環境變數的預設，平台的登入只用環境變數
        const authLimit =
          tenant && RATE_LIMIT_AUTH_PER_MINUTE_PARAM.key in tenant.featureParams
            ? resolveTenantFeatureParam(RATE_LIMIT_AUTH_PER_MINUTE_PARAM, tenant.featureParams)
            : undefined;
        // 平台設定的租戶白名單（feature 參數）：來自這些網段的登入，IP 桶的上限 ×10；帳號、延遲、租戶桶不變
        const trustedSource =
          tenant !== undefined &&
          cidrMatcher(
            resolveTenantFeatureParam(RATE_LIMIT_TRUSTED_CIDRS_PARAM, tenant.featureParams),
          )(rawIp);
        return {
          ip,
          exempt,
          trustedSource,
          account,
          // 已登入的帳號類端點（改密碼）沒有 email：以身分計（rate-limit.ts 的 rateLimitBucketsOf）
          principal: account ? undefined : await this.principalOf(req),
          tenant: { key: tenant?.id ?? 'platform', authLimit },
        };
      }
      case 'refresh': {
        const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
        const raw = cookies?.[this.refreshCookieName];
        // 只存雜湊：計數的 key 會留在記憶體裡
        return {
          ip,
          exempt,
          session: raw ? createHash('sha256').update(raw).digest('hex') : undefined,
        };
      }
      default:
        return { ip, exempt, principal: await this.principalOf(req) };
    }
  }

  private async principalOf(req: Request): Promise<string | undefined> {
    const payload = await this.verifier.verifyClaims(extractBearer(req.headers.authorization));
    if (!payload) return undefined;
    const tenant = currentTenant();
    return tenant ? `t:${tenant.id}:${payload.sub}` : `p:${payload.sub}`;
  }
}
