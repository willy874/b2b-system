import { AsyncLocalStorage } from 'node:async_hooks';

import type { Database } from '../database';
import { AppException } from '../errors';
import type { FeatureFlagOverrides } from '../feature-flags/feature-flags';
import type { TenantFeature } from './tenant-features';

/** 目前執行的程式屬於哪個租戶，以及它的 database（docs/adr/0020-physical-tenant-isolation.md D3）。 */
export interface TenantContext {
  id: string;
  code: string;
  db: Database;
  /** 物件儲存的 bucket（docs/adr/0020-physical-tenant-isolation.md D16）。 */
  storageBucket: string;
  /** 平台管理者為這個租戶啟用的 feature（docs/adr/0021-runtime-feature-activation.md D8）。 */
  features: readonly TenantFeature[];
  /**
   * 平台管理者為這個租戶設的 feature flag 覆寫（docs/adr/0022-feature-flags.md D2）；生效值由
   * `FeatureFlagService.isEnabled()` 合併全平台層與預設值算出，不要直接讀這裡判斷。
   */
  flags: FeatureFlagOverrides;
}

const storage = new AsyncLocalStorage<TenantContext>();

/** 在租戶脈絡中執行 `fn`；`fn` 裡（含之後的非同步延續）存取 `TENANT_DB` 都會連到這個租戶。 */
export function runInTenantContext<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * 目前的租戶；沒有租戶脈絡時拋 `TENANT_NOT_FOUND`。HTTP 上代表請求的網域不屬於任何租戶；
 * 在背景工作或腳本裡出現代表呼叫端忘了 `runInTenant`，同樣不退回任何預設的 database。
 */
export function requireTenant(): TenantContext {
  const context = storage.getStore();
  if (!context) throw new AppException('TENANT_NOT_FOUND');
  return context;
}
