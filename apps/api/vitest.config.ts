import { fileURLToPath } from 'node:url';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

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
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // 必填但測試用不到真正連線的環境變數；個別測試仍可在 beforeAll 覆寫
    env: {
      FILE_STORAGE_ACCESS_KEY_ID: 'test-access-key',
      FILE_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
      // 預設不執行背景工作（排程、worker 不在其他測試裡偷跑）；test/jobs.spec.ts 自己打開
      JOBS_WORKER_ENABLED: 'false',
    },
    // 整合測試共用同一個 container，檔案之間依序執行以避免互相污染
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/db/migrations/**'],
    },
  },
});
