import { defineConfig, devices } from '@playwright/test';

const WEB_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

/**
 * 功能導覽的截圖（docs/guide/introduction/03-feature-tour.md）：不是測試，而是照固定劇本建立資料、逐頁拍照，
 * 輸出到 docs/guide/images/tour/。和 E2E 共用 global-setup（重置資料庫），所以只能對著 E2E 或隔離的環境跑。
 * 服務要先啟動（backstage、apps/platform、api、file-storage），這裡不起 webServer。
 */
export default defineConfig({
  testDir: './tour',
  globalSetup: './tour/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  // 拍照不是測試：等待放寬，機器忙（例如同時跑著整合測試）時不至於一路逾時
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: WEB_URL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    colorScheme: 'light',
    actionTimeout: 20_000,
  },
  projects: [{ name: 'tour' }],
});
