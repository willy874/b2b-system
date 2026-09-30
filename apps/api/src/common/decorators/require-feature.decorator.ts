import { SetMetadata } from '@nestjs/common';

import type { TenantFeature } from '@/core/tenant';

export const REQUIRED_FEATURE = 'tenancy:requiredFeature';

/**
 * 這個 controller（或 handler）屬於可啟用的 feature（docs/adr/0021-runtime-feature-activation.md D11）：
 * 租戶沒有啟用時由 `FeatureGuard` 回 `FEATURE_DISABLED`（404）。可標在 class 或 handler；兩者都有時以 handler 為準。
 *
 * 與授權宣告（`@Public` / `@Authenticated` / `@RequirePermissions`）是兩回事、兩者都要寫：這裡只回答
 * 「這個租戶有沒有這個功能」，「這個人能不能用」仍由權限決定。
 */
export const RequireFeature = (feature: TenantFeature) => SetMetadata(REQUIRED_FEATURE, feature);
