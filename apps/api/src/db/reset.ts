import { sql } from 'drizzle-orm';

import {
  assertDisposableScriptTargets,
  createPlatformScriptClient,
  forEachScriptTenant,
  loadScriptEnv,
} from './client';

/**
 * 清空所有業務資料（保留 schema、migration 紀錄與租戶登記）。平台 DB 只清 IdP 的協定狀態；每個租戶的 DB 各自清空。
 * 動手前先檢查目標：正式環境的平台 DB 一律拒絕，不在本機的 DB 要加 `--confirm <平台 database 名稱>`
 * （`script-guard.ts`，docs/architecture/backend/02-database.md §6.1）。
 */
async function main(): Promise<void> {
  loadScriptEnv();
  await assertDisposableScriptTargets('db:reset');
  const platform = createPlatformScriptClient();
  await platform.db.execute(
    sql`TRUNCATE oidc_payloads, platform_refresh_tokens, platform_auth_tokens`,
  );
  await platform.client.end();

  await forEachScriptTenant(async (db) => {
    await db.execute(
      sql`TRUNCATE users, roles, groups, permissions, relation_tuples, approval_requests, files, file_folders, system_settings, refresh_tokens, auth_tokens, audit_logs, audit_logs_archive, job_outbox, identity_providers, identity_provider_domains, user_identities RESTART IDENTITY CASCADE`,
    );
    // 已用量的計數是單列（migration 0036），不能 TRUNCATE：檔案清空了，計數歸零
    await db.execute(sql`UPDATE file_storage_usage SET used_bytes = 0, reconciled_at = NULL`);
  });
  console.info('資料庫已清空（schema 與租戶登記保留）');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
