import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppException } from '@/core/errors';
import { currentTenant } from '@/core/tenant';
import type { TenantFeature } from '@/core/tenant';

import { REQUIRED_FEATURE } from '../decorators';

/**
 * 擋下租戶未啟用的 feature 的端點（docs/adr/0021-runtime-feature-activation.md D11）：回 `FEATURE_DISABLED`（404），
 * 不暴露功能存在。前端依清單隱藏只是體驗，這裡才是存取控制。
 *
 * 順序：全域 guard 排在 `JwtAuthGuard` **之後**、`PermissionsGuard` **之前**（app.module.ts）。
 * - 在 JWT 之後：未登入的請求照舊回 401，未登入者看不到「這個租戶有沒有開這個功能」。
 *   `@Public()` 的端點（檔案的簽章影像網址）不驗 token，所以在未啟用時會回 404——那本來就是「功能不存在」。
 * - 在權限之前：功能沒開時一律 404，不先以 403 告訴沒有權限的人端點存在，也不為了一個不存在的功能寫 `authz.denied` 稽核。
 *
 * 沒有租戶脈絡（平台的請求）時不判斷：可啟用的 feature 都是租戶的功能，平台的端點不該標 `@RequireFeature`
 * （`common/route-audit.ts` 會擋）。WebSocket 不經過這裡（Nest 的 WS context 不套 `APP_GUARD`）。
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const feature = this.reflector.getAllAndOverride<TenantFeature | undefined>(REQUIRED_FEATURE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!feature) return true;
    const tenant = currentTenant();
    if (!tenant) return true;
    if (!tenant.features.includes(feature)) throw new AppException('FEATURE_DISABLED');
    return true;
  }
}
