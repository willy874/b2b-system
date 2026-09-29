import { expect, test } from '@playwright/test';

import { AUTH_URL, expectIdpLogin, loginAndWaitForHome, logout } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';

/**
 * SSO 的協定邊界與 apps/auth 的平台頁面（docs/adr/0019-sso-identity-platform.md）。
 * 基本的登入、跨產品免登入、從 backstage 單一登出在 auth.spec.ts；外部 IdP 在 sso-external.spec.ts。
 */
test.describe('SSO', () => {
  test('在 IdP 的登入頁按取消 → 回到 backstage 並顯示「已取消」，可以重新登入', async ({
    page,
  }) => {
    await page.goto('/auth/login');
    await expectIdpLogin(page);
    await page.getByTestId('login-cancel').click();

    await expect(page).toHaveURL(/localhost:5173\/auth\/callback\?.*error=access_denied/);
    await page.getByTestId('sso-callback-retry').click();
    await expectIdpLogin(page);
  });

  test('未登記的 redirect URI → 停在 apps/auth 的錯誤頁，不會把授權碼送出去（D7）', async ({
    page,
  }) => {
    const query = new URLSearchParams({
      client_id: 'backstage',
      redirect_uri: 'https://evil.example/callback',
      response_type: 'code',
      scope: 'openid',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
    });
    await page.goto(`${AUTH_URL}/api/oidc/auth?${query.toString()}`);
    await expect(page).toHaveURL(new RegExp(`^${AUTH_URL}/error`));
    await expect(getByTestIdAndValue(page, 'sso-error', 'invalid_redirect_uri')).toBeVisible();
  });

  test('從 apps/auth 登出 → backstage 的 session 也結束（D5）', async ({ page }) => {
    await loginAndWaitForHome(page, 'admin');
    await page.goto(AUTH_URL);
    await expect(page.getByTestId('home-display-name')).toBeVisible();
    await logout(page);
    await expect(page).toHaveURL(/\/login\?.*signedOut=true/);

    // backstage 的 refresh 家族已在伺服器端撤銷，IdP session 也不在了：要重新輸入密碼
    await page.goto('/');
    await expect(async () => {
      const url = page.url();
      expect(url.includes('signedOut=true') || url.startsWith(`${AUTH_URL}/interaction/`)).toBe(
        true,
      );
    }).toPass();
    await page.goto('/auth/login');
    await expectIdpLogin(page);
  });

  test('auditor 在 apps/auth 看得到外部 IdP 連線，但沒有任何操作按鈕', async ({ page }) => {
    await loginAndWaitForHome(page, 'auditor');
    await page.goto(AUTH_URL);
    await page.getByTestId('menu-identity-provider').click();
    await expect(page.getByTestId('identity-provider-page')).toBeVisible();
    await expect(page.getByTestId('identity-provider-create-button')).toHaveCount(0);
  });

  test('member 在 apps/auth 沒有平台選單，直接進網址是 403 頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await page.goto(`${AUTH_URL}/identity-providers`);
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
    await expect(page.getByTestId('menu-identity-provider')).toHaveCount(0);
  });
});
