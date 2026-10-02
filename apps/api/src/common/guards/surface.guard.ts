import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppException } from '@/core/errors';

import { API_SURFACE } from '../decorators';
import type { ApiSurface } from '../decorators';

/** 這個程序是哪一個入口：組裝根（`app.module.ts`、`external-api.module.ts`）各自提供。 */
export const PROCESS_SURFACE = Symbol('PROCESS_SURFACE');
export type ProcessSurface = Exclude<ApiSurface, 'both'>;

/**
 * 另一個入口的路由回 404（docs/architecture/06-external-api.md §9.2 D11）：排在所有全域 guard 的第一個，
 * 不驗身分、不限流，就像那條路由不存在。內部 api 的 `/v1/*` 與對外 API 的 `/users` 都是這樣。
 */
@Injectable()
export class SurfaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PROCESS_SURFACE) private readonly surface: ProcessSurface,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    // WebSocket 只在內部 api（對外 API 不掛 gateway）
    if (ctx.getType() !== 'http') return true;
    const route =
      this.reflector.getAllAndOverride<ApiSurface | undefined>(API_SURFACE, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? 'internal';
    if (route === 'both' || route === this.surface) return true;
    throw new AppException('NOT_FOUND');
  }
}
