import { expect, test } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { AUTH_URL, expectIdpLogin, login } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';

/**
 * 外部 IdP 登入（docs/adr/0019-sso-identity-platform.md D8–D10）。外部 IdP 是 `pnpm dev:mock-idp`
 * （playwright.config.ts 會啟動）：登入頁輸入任何 email 都算登入成功。
 */
const MOCK_IDP = {
  name: 'E2E 模擬 IdP',
  issuer: process.env.E2E_MOCK_IDP_URL ?? 'http://localhost:4455',
  clientId: 'b2b-mock',
  clientSecret: 'mock-secret',
};
const SSO_DOMAIN = 'e2e-sso.test';

test.describe('外部 IdP 登入', () => {
  test.beforeAll(async () => {
    const token = await apiLogin('superAdmin');
    const created = await apiRequest(token, 'post', '/identity-providers', {
      ...MOCK_IDP,
      unmatchedPolicy: 'auto_create',
      domains: [{ domain: SSO_DOMAIN, ssoOnly: true }],
    });
    // E2E_SKIP_SEED=1 重跑時連線已經存在
    expect([201, 409]).toContain(created.status);
  });

  test('只允許 SSO 的網域：不顯示密碼欄，經外部 IdP 登入後自動建立帳號並回到 backstage', async ({
    page,
  }) => {
    const email = `sso-${Date.now()}@${SSO_DOMAIN}`;
    await page.goto('/auth/login');
    await expectIdpLogin(page);

    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-email').blur();
    await expect(page.getByTestId('login-sso-only')).toBeVisible();
    await expect(page.getByTestId('login-password')).toHaveCount(0);
    await page.getByTestId('login-external').click();

    // 模擬 IdP 的登入與同意頁（oidc-provider devInteractions）
    await expect(page).toHaveURL(new RegExp(`^${MOCK_IDP.issuer}/`));
    await page.locator('input[name="login"]').fill(email);
    await page.locator('input[name="password"]').fill('anything');
    await page.locator('button[type="submit"]').click();
    await page.locator('button[type="submit"]').click();

    // 外部 IdP → api 的固定 callback → 完成互動 → backstage 的 callback → 首頁
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page).toHaveURL(/localhost:5173\//);
  });

  test('只允許 SSO 的網域：在 email 欄按 Enter 就走外部 IdP（沒有密碼登入可選）', async ({
    page,
  }) => {
    await page.goto('/auth/login');
    await expectIdpLogin(page);
    await page.getByTestId('login-email').fill(`someone@${SSO_DOMAIN}`);
    await page.getByTestId('login-email').blur();
    await expect(page.getByTestId('login-sso-only')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toHaveCount(0);
    await page.getByTestId('login-email').press('Enter');
    await expect(page).toHaveURL(new RegExp(`^${MOCK_IDP.issuer}/`));
  });

  test('管理頁列出連線與要登記在外部 IdP 的 redirect URI', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByTestId('home-page')).toBeVisible();
    await page.goto(`${AUTH_URL}/identity-providers`);
    await expect(page.getByTestId('identity-provider-page')).toBeVisible();
    await expect(getByTestIdAndValue(page, 'identity-provider-domain', SSO_DOMAIN)).toBeVisible();
    await expect(page.getByTestId('identity-provider-callback-url')).toHaveValue(
      `${AUTH_URL}/api/oidc-interaction/external/callback`,
    );
  });
});
