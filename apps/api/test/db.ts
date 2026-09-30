import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { inject } from 'vitest';

import * as platformSchema from '@/db/platform/schema';
import * as relations from '@/db/relations';
import * as schema from '@/db/schema';

export function createTestDatabase() {
  const client = postgres(inject('databaseUrl'), { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: { ...schema, ...relations } });
  return { client, db };
}

export type TestDatabase = ReturnType<typeof createTestDatabase>['db'];

/** 平台 DB（租戶登記、平台管理者；docs/adr/0020-physical-tenant-isolation.md D1）。 */
export function createPlatformTestDatabase() {
  const client = postgres(inject('platformDatabaseUrl'), { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: platformSchema });
  return { client, db };
}

export type PlatformTestDatabase = ReturnType<typeof createPlatformTestDatabase>['db'];

/** 每個 suite 之間清空業務資料（保留 schema 與 migration 紀錄）。 */
export async function truncateAll(db: TestDatabase): Promise<void> {
  await db.execute(
    sql`TRUNCATE approval_requests, files, file_folders, resource_grants, relation_tuples, users, roles, permissions, user_roles, role_permissions, refresh_tokens, auth_tokens, audit_logs, audit_logs_archive, system_settings RESTART IDENTITY CASCADE`,
  );
}

/** Drizzle 把驅動錯誤包成 `Failed query: …`，真正的訊息在 `cause`。 */
export async function expectDbError(operation: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await operation;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    const message = cause?.message ?? (error as Error).message;
    if (!pattern.test(message)) {
      throw new Error(`預期錯誤符合 ${String(pattern)}，實際為：${message}`);
    }
    return;
  }
  throw new Error(`預期操作被資料庫擋下（${String(pattern)}），但它成功了`);
}
