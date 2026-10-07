import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppException } from '@/core/errors';
import { FeatureFlagService } from '@/core/feature-flags';
import { currentTenant } from '@/core/tenant';

import { REQUIRED_FLAG, requiredFeaturesOf } from '../decorators';

/**
 * 擋下租戶未啟用的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D11）與關閉中的 feature flag
 * （docs/architecture/05-tenancy.md §11.2 D5）的端點：回 `FEATURE_DISABLED`（404），不暴露功能存在。
 * 前端依清單隱藏只是體驗，這裡才是存取控制。`@RequireFeature` 與 `@RequireFlag` 並存時兩者都要成立；
 * handler 與 class 各自的 `@RequireFeature` 合併計算，列出的 feature 都要啟用；對外 API 的路由（`@ExternalApi()`）
 * 另外一律要求 `externalApi`（`requiredFeaturesOf`，docs/architecture/06-external-api.md §3.1）。
 *
 * 順序：全域 guard 排在 `JwtAuthGuard`（對外 API 是 `ApiTokenAuthGuard`）**之後**、`PermissionsGuard` **之前**（app.module.ts）。
 * - 在 JWT 之後：未登入的請求照舊回 401，未登入者看不到「這個租戶有沒有開這個功能」。
 *   `@Public()` 的端點（檔案的簽章影像網址）不驗 token，所以在未啟用時會回 404——那本來就是「功能不存在」。
 * - 在權限之前：功能沒開時一律 404，不先以 403 告訴沒有權限的人端點存在，也不為了一個不存在的功能寫 `authz.denied` 稽核。
 *
 * 沒有租戶脈絡（平台的請求）時不判斷：兩者都以租戶為單位，平台的端點不該標 `@RequireFeature` / `@RequireFlag`
 * （`common/route-audit.ts` 會擋）。WebSocket 的訊息也會經過這裡（Nest 12 起全域 guard 套用到 gateway），直接放行。
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlagService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const features = requiredFeaturesOf(this.reflector, targets);
    const flag = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_FLAG, targets);
    if (!features.length && !flag) return true;
    const tenant = currentTenant();
    if (!tenant) return true;
    if (features.some((feature) => !tenant.features.includes(feature))) {
      throw new AppException('FEATURE_DISABLED');
    }
    if (flag && !this.flags.isEnabled(flag)) throw new AppException('FEATURE_DISABLED');
    return true;
  }
}
