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
  // 前端錯誤回報的 release（docs/architecture/frontend/19-observability.md §3）：CI 與 Docker 帶 commit，本機是 dev
  define: { __APP_RELEASE__: JSON.stringify(process.env.APP_RELEASE ?? 'dev') },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // apps/platform 是獨立的 origin（docs/architecture/04-sso.md §12.2 D6）：backstage 5173、backstage-mock 5174
    // 並行跑第二組環境時以 PLATFORM_DEV_PORT 換埠（同 backstage 的 BACKSTAGE_DEV_PORT）
    port: Number(process.env.PLATFORM_DEV_PORT ?? 5175),
    strictPort: true,
    proxy: {
      // 前端一律打 `/api`，不在程式碼裡寫死後端位址（docs/architecture/01-system.md §4.1）。
      '/api': {
        target: process.env.DEV_API_PROXY_TARGET ?? 'http://localhost:3000',
        // 保留瀏覽器看到的 Host（含 port）：api 以它決定租戶（docs/architecture/05-tenancy.md §10.2 D2）
        changeOrigin: false,
        // 即時推播的 WebSocket（`/api/socket.io` → `/socket.io`，同一個 rewrite）
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // 前端錯誤回報的收件（apps/apm-service）：DSN 是同源的 /apm/<專案 id>，轉發時去掉前綴（同 deploy/nginx.conf）。
      // 只有設了 VITE_APM_* 才會送（預設只 console.debug）；要收時另外起 pnpm dev:apm
      '/apm': {
        target: process.env.DEV_APM_PROXY_TARGET ?? 'http://127.0.0.1:9100',
        rewrite: (path) => path.replace(/^\/apm/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    // 正式產物不公開 sourcemap（nginx 會原樣提供 dist 裡的每個檔案）；要上傳到錯誤追蹤服務時
    // 以 BUILD_SOURCEMAP=hidden 建置，產生 .map 但不在 js 裡留參照，上傳後刪掉再部署
    sourcemap: process.env.BUILD_SOURCEMAP === 'hidden' ? 'hidden' : false,
    // bundle 預算的檢查讀它（scripts/check-bundle-budget.mjs）；只在檢查時產生，正式產物不帶（nginx 會原樣提供 dist）
    manifest: process.env.BUILD_MANIFEST === 'true',
  },
}));
