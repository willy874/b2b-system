import { describe, expect, it } from 'vitest';

import type { Database } from '../../database';
import { runInTenantContext } from '../tenant-context';
import type { TenantContext } from '../tenant-context';
import { createTenantDbProxy } from '../tenant-db.provider';

describe('TENANT_DB 代理（docs/adr/0020-physical-tenant-isolation.md D3）', () => {
  it('啟動時 Nest 的探測（then、constructor、生命週期 hook）沒有租戶也不拋錯', () => {
    const db = createTenantDbProxy() as unknown as Record<string, unknown>;
    for (const probe of [
      'then',
      'constructor',
      'onModuleInit',
      'onApplicationBootstrap',
      'onModuleDestroy',
      'beforeApplicationShutdown',
      'onApplicationShutdown',
    ]) {
      expect(db[probe]).toBeUndefined();
    }
  });

  it('沒有租戶脈絡時存取查詢方法 → TENANT_NOT_FOUND', () => {
    const db = createTenantDbProxy();
    expect(() => db.select).toThrow('TENANT_NOT_FOUND');
  });

  it('在租戶脈絡中轉到該租戶的 database', () => {
    const tenantDb = { marker: 'tenant-a' } as unknown as Database;
    const db = createTenantDbProxy() as unknown as Record<string, unknown>;
    const context = { db: tenantDb } as unknown as TenantContext;
    expect(runInTenantContext(context, () => db.marker)).toBe('tenant-a');
  });
});
