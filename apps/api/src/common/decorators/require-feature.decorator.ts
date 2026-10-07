import { SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { TenantFeature } from '@/core/tenant';

import { API_SURFACE } from './api-surface.decorator';
import type { ApiSurface } from './api-surface.decorator';

export const REQUIRED_FEATURE = 'tenancy:requiredFeature';

/**
 * 這個 controller（或 handler）屬於可啟用的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D11）：
 * 租戶沒有啟用時由 `FeatureGuard` 回 `FEATURE_DISABLED`（404）。可標在 class 或 handler；兩者都有時 **都要啟用**
 * （例：檔案 controller 標 `file`、其中的還原端點再標 `trash`，docs/architecture/05-tenancy.md §12.2 D3）。
 *
 * 與授權宣告（`@Public` / `@Authenticated` / `@RequirePermissions`）是兩回事、兩者都要寫：這裡只回答
 * 「這個租戶有沒有這個功能」，「這個人能不能用」仍由權限決定。
 */
export const RequireFeature = (...features: [TenantFeature, ...TenantFeature[]]) =>
  SetMetadata(REQUIRED_FEATURE, features);

/**
 * 一個路由實際要求的 feature：handler 與 class 的 `@RequireFeature` 合併，**對外 API 的路由（`@ExternalApi()`）一律再加上
 * `externalApi`**（docs/architecture/06-external-api.md §3.1）。不必在每個對外 controller 上標，新增的對外端點也不會漏掉；
 * 兩邊都有的路由（`@Surface('both')`，健康檢查）不算對外。
 *
 * `FeatureGuard`（擋請求）與 `route-audit`（收集宣告）共用這一份規則。
 */
export function requiredFeaturesOf(
  reflector: Reflector,
  targets: Parameters<Reflector['getAllAndOverride']>[1],
): TenantFeature[] {
  const declared = reflector.getAllAndMerge<TenantFeature[]>(REQUIRED_FEATURE, targets);
  const surface = reflector.getAllAndOverride<ApiSurface | undefined>(API_SURFACE, targets);
  if (surface !== 'external' || declared.includes('externalApi')) return declared;
  return [...declared, 'externalApi'];
}
