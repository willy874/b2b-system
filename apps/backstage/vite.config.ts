import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import unocss from 'unocss/vite';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import svgr from 'vite-plugin-svgr';

const MOCK_WORKER_FILE = 'mockServiceWorker.js';

/**
 * MSW 的 Service Worker 腳本：直接取已安裝的 msw 套件裡那一份，不 commit 生成檔（版本永遠一致）。
 * 只在 `VITE_ENABLE_MOCK=true` 時提供——dev 由 middleware 回應、建置時才輸出到 dist；
 * 放進 `public/` 的話每個正式產物都會帶著它。
 */
function mockServiceWorker(): Plugin {
  let enabled = false;
  const read = () => readFileSync(fileURLToPath(import.meta.resolve(`msw/${MOCK_WORKER_FILE}`)));
  return {
    name: 'b2b-system:mock-service-worker',
    configResolved(config) {
      enabled = config.env.VITE_ENABLE_MOCK === 'true';
    },
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use(`${server.config.base}${MOCK_WORKER_FILE}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(read());
      });
    },
    generateBundle() {
      if (enabled) this.emitFile({ type: 'asset', fileName: MOCK_WORKER_FILE, source: read() });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [unocss(), react(), svgr(), mockServiceWorker()],
  css: {
    modules: {
      // 開發時保留檔名與 class 名稱，DevTools 裡一眼看得出是哪個元件的哪一層；
      // 正式建置只留 hash，縮短輸出。
      generateScopedName:
        command === 'serve' ? 'ge-[name]__[local]__[hash:base64:4]' : 'ge-[hash:base64:6]',
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
    // 預設 5173；並行跑第二組環境（例：E2E 用暫用 DB）時以 BACKSTAGE_DEV_PORT 換埠。
    port: Number(process.env.BACKSTAGE_DEV_PORT ?? 5173),
    // 被占用時直接失敗，不自動改用下一個埠：E2E、REALTIME_ALLOWED_ORIGINS、DEFAULT_TENANT_DOMAINS 都寫死這個埠。
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
      // 物件儲存（apps/file-storage）：presigned URL 簽的是瀏覽器看到的 host 與完整路徑，
      // 所以 **不** changeOrigin、**不** rewrite；file-storage 以 FILE_STORAGE_BASE_PATH=/storage 接收
      // （docs/architecture/backend/09-file.md §3）
      '/storage': {
        target: 'http://localhost:9000',
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
    rolldownOptions: {
      output: {
        // 首頁一定整包用到的依賴各放一個 chunk（docs/architecture/frontend/19-observability.md §7.2）：
        // 否則依「哪些頁面共用」被切成上百個小 chunk 各自壓縮，字典無法共用；vendor 的 hash 也不隨 app 的修改改變。
        // 只能放首頁整包用到的套件：Base UI 這類只有部分元件在首頁的放進來，會把 lazy 頁面才用的部分拉回首頁。
        // apps/backstage 與 apps/platform 各一份，改動時兩邊一起改（apps/platform/README.md）。
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: 'tanstack',
              test: /node_modules[\\/]@tanstack[\\/](router-core|react-router|history|store|react-store|query-core|react-query)[\\/]/,
              priority: 20,
            },
            { name: 'i18n', test: /node_modules[\\/](i18next|react-i18next)[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
}));
