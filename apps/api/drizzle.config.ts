import { defineConfig } from 'drizzle-kit';

/** 租戶 DB 的 migration 線（每個租戶的 database 都跑這一套）；平台 DB 見 drizzle.platform.config.ts。 */
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DEFAULT_TENANT_DATABASE_URL ??
      'postgres://b2bsystem:b2bsystem@localhost:5432/b2b_system',
  },
  verbose: true,
  strict: true,
});
