import { defineConfig } from 'drizzle-kit';

/** 平台 DB 的 migration 線（docs/architecture/05-tenancy.md §10.2 D1）；租戶 DB 見 drizzle.config.ts。 */
export default defineConfig({
  schema: './src/db/platform/schema/index.ts',
  out: './src/db/platform/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.PLATFORM_DATABASE_URL ??
      'postgres://b2bsystem:b2bsystem@localhost:5432/b2b_platform',
  },
  verbose: true,
  strict: true,
});
