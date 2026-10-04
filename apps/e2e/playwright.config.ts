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
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // backstage 與 apps/platform（SSO 的登入互動頁，docs/architecture/04-sso.md §12）；api 要另外啟動（pnpm dev:e2e）
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
        // 外部 IdP 登入用的模擬 OIDC provider（tests/sso-external.spec.ts）
        {
          command: 'pnpm dev:mock-idp',
          url: 'http://localhost:4455/.well-known/openid-configuration',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          cwd: '../..',
        },
      ],
});
