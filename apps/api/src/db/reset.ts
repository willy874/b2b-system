import { sql } from 'drizzle-orm';

import { createScriptClient, loadScriptEnv } from './client';

/** 清空所有業務資料（保留 schema 與 migration 紀錄）。production 禁止執行。 */
async function main(): Promise<void> {
  loadScriptEnv();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:reset 不可在 production 執行');
  }
  const { client, db } = createScriptClient();
  await db.execute(
    sql`TRUNCATE users, roles, permissions, user_roles, role_permissions, refresh_tokens, auth_tokens, audit_logs RESTART IDENTITY CASCADE`,
  );
  console.info('資料庫已清空（schema 保留）');
  await client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
