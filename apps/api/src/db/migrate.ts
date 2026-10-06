import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import {
  createPlatformScriptClient,
  ensureDatabase,
  listScriptTenants,
  loadScriptEnv,
  tenantSecretBox,
} from './client';
import type { TenantRegistration } from './platform/register-tenant';
import { registerTenant } from './platform/register-tenant';
import { tenants } from './platform/schema';
import { ensureExtensions, migrateTenantDatabase, PLATFORM_MIGRATIONS_FOLDER } from './provision';
import { markProductionEnvironment } from './script-guard';

export interface MigrateAllOptions {
  platformUrl: string;
  /** 平台 DB 一個租戶都沒有（含已刪除的）時登記的租戶：第一次部署的預設租戶。 */
  defaultTenant?: TenantRegistration;
  /** production 的部署：在平台 DB 寫入環境標記（`script-guard.ts`）。 */
  production?: boolean;
}

export interface MigrateAllResult {
  /** migration 完成的租戶代碼。 */
  migrated: string[];
  /** 佈建中、佈建失敗而略過的租戶代碼。 */
  skipped: string[];
  /** migration 失敗的租戶代碼。 */
  failed: string[];
}

/**
 * 先跑平台 DB，再依序跑每個租戶的 DB（docs/architecture/05-tenancy.md §10.2 D14）。
 *
 * - 平台 DB 失敗就拋錯：沒有平台 DB 任何租戶都不能用。
 * - 佈建中、佈建失敗的租戶略過：它們的 DB 可能還不存在，migration 由佈建與「重試佈建」負責。
 * - 單一租戶失敗不影響其他租戶，也不拋錯：落後的租戶由 api 回 `503 TENANT_UNAVAILABLE`，不擋住整個程序啟動。
 * - 預設租戶只在平台 DB 一個租戶都沒有（含已刪除的）時登記；刪除預設租戶之後不會再被登記回來。
 */
export async function migrateAll(options: MigrateAllOptions): Promise<MigrateAllResult> {
  await ensureDatabase(options.platformUrl);
  const platform = createPlatformScriptClient(options.platformUrl);
  const result: MigrateAllResult = { migrated: [], skipped: [], failed: [] };
  try {
    await ensureExtensions(platform.db);
    await migrate(platform.db, { migrationsFolder: PLATFORM_MIGRATIONS_FOLDER });
    if (options.production) await markProductionEnvironment(platform.db);
    console.info('平台 DB：migration 完成');

    if (options.defaultTenant) {
      const [row] = await platform.db.select({ total: sql<number>`count(*)::int` }).from(tenants);
      if (!row?.total) await registerTenant(platform.db, options.defaultTenant, tenantSecretBox());
    }

    for (const tenant of await listScriptTenants(platform.db)) {
      if (tenant.status === 'provisioning' || tenant.status === 'failed') {
        console.info(
          `租戶 ${tenant.code}：${tenant.status}，略過（由佈建或「重試佈建」跑 migration）`,
        );
        result.skipped.push(tenant.code);
        continue;
      }
      try {
        // oxlint-disable-next-line no-await-in-loop -- 依序處理，錯誤訊息對得上是哪個租戶
        await ensureDatabase(tenant.databaseUrl);
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await migrateTenantDatabase(tenant.databaseUrl);
        console.info(`租戶 ${tenant.code}：migration 完成`);
        result.migrated.push(tenant.code);
      } catch (error) {
        console.error(`租戶 ${tenant.code}：migration 失敗`, error);
        result.failed.push(tenant.code);
      }
    }
  } finally {
    await platform.client.end();
  }
  return result;
}

/**
 * `pnpm db:migrate [--strict]`。結束碼：平台 DB 失敗才非零；租戶失敗只列出來。
 * `--strict`（CI 用）：任何租戶失敗也以非零結束。
 */
async function main(): Promise<void> {
  loadScriptEnv();
  const platformUrl = process.env.PLATFORM_DATABASE_URL;
  if (!platformUrl) throw new Error('PLATFORM_DATABASE_URL 未設定');
  const defaultUrl = process.env.DEFAULT_TENANT_DATABASE_URL;
  const result = await migrateAll({
    platformUrl,
    production: process.env.NODE_ENV === 'production',
    defaultTenant: defaultUrl
      ? {
          code: process.env.DEFAULT_TENANT_CODE || 'default',
          name: process.env.DEFAULT_TENANT_NAME || '預設租戶',
          databaseUrl: defaultUrl,
          // 預設租戶沿用租戶化之前共用的 bucket，既有的檔案不必搬
          storageBucket: process.env.DEFAULT_TENANT_STORAGE_BUCKET || 'b2b-system',
          domains: (process.env.DEFAULT_TENANT_DOMAINS ?? '').split(','),
        }
      : undefined,
  });
  if (result.failed.length) {
    console.error(
      `migration 失敗的租戶：${result.failed.join(', ')}（這些租戶回 503，其他租戶照常服務；修好後重跑 db:migrate）`,
    );
    if (process.argv.includes('--strict')) process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
