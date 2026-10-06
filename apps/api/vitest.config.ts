import { fileURLToPath } from 'node:url';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** `src/` 底下唯一要資料庫的測試：import `test/db` 的 `createTestDatabase()`。 */
const SEED_SPEC = 'src/db/seeds/__tests__/seed.spec.ts';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // 必填但測試用不到真正連線的環境變數；個別測試仍可在 beforeAll 覆寫
    env: {
      FILE_STORAGE_ACCESS_KEY_ID: 'test-access-key',
      FILE_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
      // 預設不執行背景工作（排程、worker 不在其他測試裡偷跑）；test/jobs.spec.ts 自己打開
      JOBS_WORKER_ENABLED: 'false',
    },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // 兩層分開（docs/architecture/backend/07-testing.md §1）：`vitest run --project unit` 不需要 Docker
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          // 唯一要資料庫的 src 測試，歸到整合測試
          exclude: [SEED_SPEC],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.spec.ts', SEED_SPEC],
          // 一次性的 Postgres（Testcontainers）：平台 DB ＋ 測試租戶，每個檔案 inject 連線資訊
          globalSetup: ['./test/global-setup.ts'],
          setupFiles: ['./test/setup-env.ts'],
          // 共用同一個 container，檔案之間依序執行以避免互相污染
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/db/migrations/**'],
    },
  },
});
