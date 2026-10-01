import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage, normalizeIp } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Response } from 'express';

import { IS_PUBLIC } from '@/common/decorators';
import { extractBearer } from '@/common/guards';
import { RATE_LIMIT_WINDOW_MS } from '@/common/rate-limit';
import type { AuthenticatedRequest } from '@/common/types';
import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { setContextApiToken, setContextUser } from '@/core/http';

import { ApiTokenUsageService } from '../api-token-usage.service';
import { ApiTokenVerifier } from '../api-token.verifier';
import type { VerifiedApiToken } from '../api-token.verifier';

/** 對外 API 的請求：認證成功後帶著 token。 */
export interface ExternalRequest extends AuthenticatedRequest {
  apiToken?: VerifiedApiToken;
}

/**
 * 對外 API 的認證（docs/adr/0027-api-tokens-external-api.md D10）：只認 API token，不讀 cookie、不認 JWT。
 * 取代內部 api 的 `JwtAuthGuard`；之後的 `PermissionsGuard` 照常以 `req.user` 判斷，權限與 scopes 的交集由
 * `PermissionService` 依請求脈絡裡的 token 計算。
 *
 * 驗證失敗以 IP 計數（`EXTERNAL_AUTH_FAILURE_RATE_LIMIT`），超過就回 429：擋猜 token 與設定錯、不停重試的腳本。
 * 成功的請求不計這個桶，同一個 NAT 後面的其他整合不受影響。
 */
@Injectable()
export class ApiTokenAuthGuard implements CanActivate {
  private readonly failureLimit: number;

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: ApiTokenVerifier,
    private readonly usage: ApiTokenUsageService,
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    config: ConfigService<Env, true>,
  ) {
    this.failureLimit = config.get('EXTERNAL_AUTH_FAILURE_RATE_LIMIT', { infer: true });
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }
    const http = ctx.switchToHttp();
    const req = http.getRequest<ExternalRequest>();
    const result = await this.verifier.verify(extractBearer(req.headers.authorization));
    if (!result.ok) {
      await this.countFailure(req, http.getResponse<Response>());
      throw new AppException(result.code);
    }

    const { user, token } = result;
    req.user = { id: user.id, email: user.email, status: user.status };
    req.apiToken = token;
    setContextUser({ id: user.id, email: user.email });
    setContextApiToken({ id: token.id, userId: user.id, scopes: token.scopes });
    this.usage.record(token.id);
    return true;
  }

  private async countFailure(req: ExternalRequest, res: Response): Promise<void> {
    const ip = normalizeIp(req.ip ?? req.socket.remoteAddress ?? 'unknown');
    const record = await this.storage.increment(
      `externalAuthFailure:${ip}`,
      RATE_LIMIT_WINDOW_MS,
      this.failureLimit,
      RATE_LIMIT_WINDOW_MS,
      'externalAuthFailure',
    );
    if (record.isBlocked) {
      const retryAfterSeconds = Math.max(1, record.timeToBlockExpire);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      throw new AppException('RATE_LIMITED', { retryAfterSeconds });
    }
  }
}
