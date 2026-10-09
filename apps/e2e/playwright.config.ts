import { defineConfig, devices } from '@playwright/test';

const WEB_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  // 全套並行時 backstage、platform、api、對外 API 與瀏覽器在同一台機器上搶 CPU：預設的 5 秒在登入跳轉時不夠，
  // 跨兩三個帳號登入的流程（群組、公告、檔案分享）整個案例也會超過預設的 30 秒
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // backstage 與 apps/platform（SSO 的登入互動頁，docs/architecture/04-sso.md §12）、對外 API；api 要另外啟動（pnpm dev:e2e）
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          command: 'pnpm --filter @b2b-system/backstage dev',
          url: WEB_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          cwd: '../..',
        },
        {
          command: 'pnpm --filter @b2b-system/platform dev',
          url: process.env.E2E_PLATFORM_URL ?? 'http://localhost:5175',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          cwd: '../..',
        },
        // 對外 API（tests/api-token.spec.ts；docs/architecture/06-external-api.md）：與 api 共用資料庫，只認 API token
        {
          command: 'pnpm dev:external-api',
          url: `${process.env.E2E_EXTERNAL_API_URL ?? 'http://localhost:3001'}/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          cwd: '../..',
        },
        // 外部 IdP 登入用的模擬 OIDC provider（tests/sso-external.spec.ts）
        {
          command: 'pnpm dev:mock-idp',
          url: 'http://localhost:4455/.well-known/openid-configuration',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          cwd: '../..',
        },
        // SAML 的外部 IdP（tests/sso-methods.spec.ts）：127.0.0.1，與 apps/platform 不同站
        {
          command: 'pnpm dev:mock-saml-idp',
          url: 'http://127.0.0.1:4477/metadata',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          cwd: '../..',
        },
      ],
});
