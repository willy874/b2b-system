import type { FeatureFlag } from '@/shared/api-sdk';

import type { FeatureFlagGlobalChoice } from '../../constants';

export interface FeatureFlagRowVM {
  key: string;
  description: string;
  owner: string;
  /** `YYYY-MM-DD`。 */
  removeBy: string;
  /** 過了 `removeBy` 還沒移除：標示「已過期」。 */
  expired: boolean;
  defaultEnabled: boolean;
  tenantOverrides: { on: number; off: number };
  /** 全平台狀態；`default` = 沒有覆寫（後端的 `null`）。 */
  globalState: FeatureFlagGlobalChoice;
}

/**
 * adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。
 * `today` 是 `YYYY-MM-DD`，與 `removeBy` 以字串比較。
 */
export function toFeatureFlagRowVM(dto: FeatureFlag, today: string): FeatureFlagRowVM {
  return {
    key: dto.key,
    description: dto.description,
    owner: dto.owner,
    removeBy: dto.removeBy,
    expired: dto.removeBy < today,
    defaultEnabled: dto.defaultEnabled,
    tenantOverrides: dto.tenantOverrides,
    globalState: dto.globalState ?? 'default',
  };
}

/** 關鍵字比對 key、說明或負責人（不分大小寫）；API 不分頁，在前端篩選。 */
export function matchesFeatureFlagKeyword(
  row: FeatureFlagRowVM,
  keyword: string | undefined,
): boolean {
  if (!keyword) return true;
  const needle = keyword.toLowerCase();
  return [row.key, row.description, row.owner].some((value) =>
    value.toLowerCase().includes(needle),
  );
}
