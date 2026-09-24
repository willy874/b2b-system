import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import unocss from 'unocss/vite';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

export default defineConfig(({ command }) => ({
  plugins: [unocss(), react(), svgr()],
  css: {
    modules: {
      // 開發時保留檔名與 class 名稱，DevTools 裡一眼看得出是哪個元件的哪一層；
      // 正式建置只留 hash，縮短輸出。
      generateScopedName:
        command === 'serve' ? 'ge-[name]__[local]__[hash:base64:4]' : 'ge-[hash:base64:6]',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 前端一律打 `/api`，不在程式碼裡寫死後端位址（docs/architecture/01-system.md §4.1）。
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // 即時推播的 WebSocket（`/api/socket.io` → `/socket.io`，同一個 rewrite）
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}));
