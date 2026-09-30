import { sql } from 'drizzle-orm';

import { createPlatformScriptClient, forEachScriptTenant, loadScriptEnv } from './client';

/**
 * 清空所有業務資料（保留 schema、migration 紀錄與租戶登記）。production 禁止執行。
 * 平台 DB 只清 IdP 的協定狀態；每個租戶的 DB 各自清空。
 */
async function main(): Promise<void> {
  loadScriptEnv();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:reset 不可在 production 執行');
  }
  const platform = createPlatformScriptClient();
  await platform.db.execute(
    sql`TRUNCATE oidc_payloads, platform_refresh_tokens, platform_auth_tokens`,
  );
  await platform.client.end();

  await forEachScriptTenant(async (db) => {
    await db.execute(
      sql`TRUNCATE users, roles, permissions, user_roles, role_permissions, refresh_tokens, auth_tokens, audit_logs, audit_logs_archive, job_outbox, identity_providers, identity_provider_domains, user_identities RESTART IDENTITY CASCADE`,
    );
  });
  console.info('資料庫已清空（schema 與租戶登記保留）');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
