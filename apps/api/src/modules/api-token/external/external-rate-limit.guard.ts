import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectThrottlerStorage, normalizeIp } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Response } from 'express';

import { RATE_LIMIT_WINDOW_MS } from '@/common/rate-limit';
import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { currentTenant } from '@/core/tenant';

import type { ExternalRequest } from './api-token-auth.guard';

/**
 * 對外 API 的速率限制（docs/architecture/06-external-api.md §9.2 D13）：排在認證之後。
 * 認證過的請求以 **token** 計（`x:{tenantId}:token:{tokenId}`，`EXTERNAL_RATE_LIMIT`）：每個整合有自己的額度，
 * 不和本人的瀏覽器、也不和同一個 NAT 後面的其他整合共用。沒有 token 的（健康檢查）以 IP 計。
 * 計數與內部 api 一樣存在程序的記憶體（共享計數見 docs/features/multi-instance.md）。
 */
@Injectable()
export class ExternalRateLimitGuard implements CanActivate {
  private readonly tokenLimit: number;
  private readonly anonymousLimit: number;

  constructor(
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    config: ConfigService<Env, true>,
  ) {
    this.tokenLimit = config.get('EXTERNAL_RATE_LIMIT', { infer: true });
    this.anonymousLimit = config.get('ANONYMOUS_RATE_LIMIT', { infer: true });
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const http = ctx.switchToHttp();
    const req = http.getRequest<ExternalRequest>();
    const tenant = currentTenant();
    const [name, key, limit] =
      req.apiToken && tenant
        ? ['externalToken', `x:${tenant.id}:token:${req.apiToken.id}`, this.tokenLimit]
        : [
            'externalAnonymous',
            normalizeIp(req.ip ?? req.socket.remoteAddress ?? 'unknown'),
            this.anonymousLimit,
          ];
    const record = await this.storage.increment(
      `${name}:${key}`,
      RATE_LIMIT_WINDOW_MS,
      limit,
      RATE_LIMIT_WINDOW_MS,
      name,
    );
    if (record.isBlocked) {
      const retryAfterSeconds = Math.max(1, record.timeToBlockExpire);
      http.getResponse<Response>().setHeader('Retry-After', String(retryAfterSeconds));
      throw new AppException('RATE_LIMITED', { retryAfterSeconds });
    }
    return true;
  }
}
