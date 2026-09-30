import { SetMetadata } from '@nestjs/common';

export const REQUIRED_FLAG = 'tenancy:requiredFlag';

/**
 * 這個 controller（或 handler）還在以 feature flag 試行（docs/adr/0022-feature-flags.md D5）：flag 關閉時
 * `FeatureGuard` 回 `FEATURE_DISABLED`（404），與未啟用的 feature 相同。可標在 class 或 handler；兩者都有時以 handler 為準。
 * 與 `@RequireFeature` 可以並存（兩者都要成立），授權宣告照樣必填。
 *
 * key 必須在 `core/feature-flags` 的目錄裡：不在目錄裡的 key 一律視為關閉，路由稽核也會擋。
 */
export const RequireFlag = (key: string) => SetMetadata(REQUIRED_FLAG, key);
