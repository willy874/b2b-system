import { sql } from 'drizzle-orm';

import journal from '@/db/migrations/meta/_journal.json';

import type { Database } from '../database';

/**
 * 這版程式需要的租戶 migration 版本。drizzle 的 migrator 以 journal 的 `when` 當版本，
 * 套用後記在 `drizzle.__drizzle_migrations.created_at`，只套用比最後一筆新的 migration。
 */
export const EXPECTED_TENANT_MIGRATION = Math.max(...journal.entries.map((entry) => entry.when));

/** 租戶 DB 已套用到的版本；從沒跑過 migration 時回 undefined。 */
export async function appliedTenantMigration(db: Database): Promise<number | undefined> {
  const [table] = await db.execute<{ name: string | null }>(
    sql`SELECT to_regclass('drizzle.__drizzle_migrations')::text AS name`,
  );
  if (!table?.name) return undefined;
  const [row] = await db.execute<{ version: string | null }>(
    sql`SELECT max(created_at)::text AS version FROM drizzle.__drizzle_migrations`,
  );
  return row?.version ? Number(row.version) : undefined;
}
