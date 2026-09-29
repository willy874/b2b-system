import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://b2bsystem:b2bsystem@localhost:5432/b2b_system',
  },
  verbose: true,
  strict: true,
});
