import type { Database } from '../database';
import { requireTenant } from './tenant-context';

/**
 * 不是在查資料庫的探測：DI 看它是不是 Promise（`then`）、Nest 在每個 provider 上找生命週期 hook。
 * 這些在啟動時就會被讀，那時還沒有租戶。
 */
const PROBES = new Set([
  'then',
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
]);

/**
 * `TENANT_DB` 的實作：每次存取都轉到目前租戶的 database。repository 照常把它當成 `Database` 用
 * （`this.db.select()…`、`withTransaction(this.db, …)`），不必知道有多個租戶；
 * 沒有租戶脈絡時第一次存取就拋 `TENANT_NOT_FOUND`（docs/adr/0020-physical-tenant-isolation.md D3）。
 */
export function createTenantDbProxy(): Database {
  return new Proxy({} as Database, {
    get(_target, property) {
      // symbol 是除錯工具的探測（inspect、toStringTag）
      if (typeof property === 'symbol' || PROBES.has(property)) return undefined;
      const { db } = requireTenant();
      const value: unknown = Reflect.get(db, property, db);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(db)
        : value;
    },
  });
}
