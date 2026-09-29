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
    // 5173 被占用時直接失敗，不自動改用 5174：E2E、REALTIME_ALLOWED_ORIGINS 都寫死 5173。
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
    sourcemap: true,
  },
}));
