import { resolve } from 'node:path';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createScriptClient, loadScriptEnv } from './client';

async function main(): Promise<void> {
  loadScriptEnv();
  const { client, db } = createScriptClient();

  // 必要擴充：citext（大小寫不敏感 email）、pgcrypto（gen_random_uuid）
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS citext`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  await migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') });
  console.info('migration 完成');
  await client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
