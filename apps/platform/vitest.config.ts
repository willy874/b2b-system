import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), svgr()],
  // vite.config.ts 以 define 注入的 release（docs/architecture/frontend/19-observability.md §3）；測試固定 dev
  define: { __APP_RELEASE__: JSON.stringify('dev') },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.stories.tsx',
        'src/main.tsx',
        'src/test/**',
        'src/mocks/**',
      ],
    },
  },
});
