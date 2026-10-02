import { migrate } from 'drizzle-orm/postgres-js/migrator';

import {
  createPlatformScriptClient,
  ensureDatabase,
  listScriptTenants,
  loadScriptEnv,
  tenantSecretBox,
} from './client';
import { registerTenant } from './platform/register-tenant';
import { ensureExtensions, migrateTenantDatabase, PLATFORM_MIGRATIONS_FOLDER } from './provision';

/**
 * 先跑平台 DB，再依序跑每個租戶的 DB（docs/architecture/05-tenancy.md §10.2 D14）。
 * 單一租戶失敗不影響其他租戶；結束時列出失敗的租戶並以非零結束。
 *
 * 平台 DB 還沒有任何租戶、且設定了 `DEFAULT_TENANT_DATABASE_URL` 時，先登記預設租戶
 * （`DEFAULT_TENANT_CODE`、`DEFAULT_TENANT_DOMAINS`）；正式的建立與佈建在交付順序第 4 步。
 */
async function main(): Promise<void> {
  loadScriptEnv();
  const platformUrl = process.env.PLATFORM_DATABASE_URL;
  if (!platformUrl) throw new Error('PLATFORM_DATABASE_URL 未設定');
  await ensureDatabase(platformUrl);

  const platform = createPlatformScriptClient(platformUrl);
  try {
    await ensureExtensions(platform.db);
    await migrate(platform.db, { migrationsFolder: PLATFORM_MIGRATIONS_FOLDER });
    console.info('平台 DB：migration 完成');

    const defaultUrl = process.env.DEFAULT_TENANT_DATABASE_URL;
    if (defaultUrl) {
      await registerTenant(
        platform.db,
        {
          code: process.env.DEFAULT_TENANT_CODE || 'default',
          name: process.env.DEFAULT_TENANT_NAME || '預設租戶',
          databaseUrl: defaultUrl,
          // 預設租戶沿用租戶化之前共用的 bucket，既有的檔案不必搬
          storageBucket: process.env.DEFAULT_TENANT_STORAGE_BUCKET || 'b2b-system',
          domains: (process.env.DEFAULT_TENANT_DOMAINS ?? '').split(','),
        },
        tenantSecretBox(),
      );
    }

    const failed: string[] = [];
    for (const tenant of await listScriptTenants(platform.db)) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- 依序處理，錯誤訊息對得上是哪個租戶
        await ensureDatabase(tenant.databaseUrl);
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await migrateTenantDatabase(tenant.databaseUrl);
        console.info(`租戶 ${tenant.code}：migration 完成`);
      } catch (error) {
        console.error(`租戶 ${tenant.code}：migration 失敗`, error);
        failed.push(tenant.code);
      }
    }
    if (failed.length) throw new Error(`migration 失敗的租戶：${failed.join(', ')}`);
  } finally {
    await platform.client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
