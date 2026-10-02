import { SetMetadata } from '@nestjs/common';

import type { TenantFeature } from '@/core/tenant';

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
