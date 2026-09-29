import type { INestApplication } from '@nestjs/common';

import { runInTenantContext, Tenancy, TenantDirectory } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';

/**
 * 測試租戶的脈絡：直接呼叫 service（不經 HTTP）的測試要在租戶裡執行，
 * 否則存取 `TENANT_DB` 會拋 `TENANT_NOT_FOUND`（docs/adr/0020-physical-tenant-isolation.md D3）。
 */
export async function testTenantContext(app: INestApplication): Promise<TenantContext> {
  const record = await app.get(TenantDirectory).resolveHost('127.0.0.1');
  if (!record) throw new Error('測試租戶沒有登記（test/global-setup.ts）');
  return app.get(Tenancy).contextOf(record);
}

export async function inTestTenant<T>(app: INestApplication, fn: () => Promise<T>): Promise<T> {
  return runInTenantContext(await testTenantContext(app), fn);
}
