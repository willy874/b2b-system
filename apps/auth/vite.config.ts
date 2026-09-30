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
        command === 'serve' ? 'ga-[name]__[local]__[hash:base64:4]' : 'ga-[hash:base64:6]',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // apps/auth 是獨立的 origin（docs/adr/0019-sso-identity-platform.md D6）：backstage 5173、backstage-mock 5174
    port: 5175,
    strictPort: true,
    proxy: {
      // 前端一律打 `/api`，不在程式碼裡寫死後端位址（docs/architecture/01-system.md §4.1）。
      '/api': {
        target: 'http://localhost:3000',
        // 保留瀏覽器看到的 Host（含 port）：api 以它決定租戶（docs/adr/0020-physical-tenant-isolation.md D2）
        changeOrigin: false,
        // 即時推播的 WebSocket（`/api/socket.io` → `/socket.io`，同一個 rewrite）
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    // 正式產物不公開 sourcemap（nginx 會原樣提供 dist 裡的每個檔案）；要上傳到錯誤追蹤服務時
    // 以 BUILD_SOURCEMAP=hidden 建置，產生 .map 但不在 js 裡留參照，上傳後刪掉再部署
    sourcemap: process.env.BUILD_SOURCEMAP === 'hidden' ? 'hidden' : false,
  },
}));
