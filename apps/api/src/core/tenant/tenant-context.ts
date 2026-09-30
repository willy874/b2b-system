import { AsyncLocalStorage } from 'node:async_hooks';

import type { Database } from '../database';
import { AppException } from '../errors';

/** 目前執行的程式屬於哪個租戶，以及它的 database（docs/adr/0020-physical-tenant-isolation.md D3）。 */
export interface TenantContext {
  id: string;
  code: string;
  db: Database;
  /** 物件儲存的 bucket（docs/adr/0020-physical-tenant-isolation.md D16）。 */
  storageBucket: string;
  /** 平台管理者是否允許這個租戶使用外部 IdP 連線（D22）。 */
  allowExternalIdp: boolean;
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
