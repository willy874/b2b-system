import { expect, test } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD } from '../fixtures/accounts';
import {
  PLATFORM_URL,
  expectIdpLogin,
  loginAndWaitForHome,
  loginPlatform,
  logout,
} from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * SSO 的協定邊界、apps/platform 的平台管理者（docs/architecture/04-sso.md §12、0020 D5–D9）。
 * 基本的登入與從 backstage 登出在 auth.spec.ts；外部 IdP 在 sso-external.spec.ts。
 */
test.describe('SSO', () => {
  test('在 IdP 的登入頁按取消 → 回到 backstage 並顯示「已取消」，可以重新登入', async ({
    page,
  }) => {
    await page.goto('/auth/login');
    await expectIdpLogin(page);
    await page.getByTestId('login-cancel').click();

    await expect(page).toHaveURL(/localhost:5173\/auth\/callback\?.*error=access_denied/);
    await snapshot(page, 'login-cancelled');
    await page.getByTestId('sso-callback-retry').click();
    await expectIdpLogin(page);
  });

  test('未登記的 redirect URI → 停在 apps/platform 的錯誤頁，不會把授權碼送出去（D7）', async ({
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
    await page.goto(`${PLATFORM_URL}/api/oidc/auth?${query.toString()}`);
    await expect(page).toHaveURL(new RegExp(`^${PLATFORM_URL}/error`));
    await expect(getByTestIdAndValue(page, 'sso-error', 'invalid_redirect_uri')).toBeVisible();
    await snapshot(page, 'invalid-redirect-uri');
  });

  test('登入互動頁顯示要登入的租戶；平台的登入頁（apps/platform）登不進租戶的帳號', async ({
    page,
  }) => {
    await page.goto('/auth/login');
    await expectIdpLogin(page);
    await expect(page.getByText('預設租戶', { exact: false })).toBeVisible();

    await page.goto(PLATFORM_URL);
    await expectIdpLogin(page);
    await expect(page.getByTestId('login-register-link')).toHaveCount(0);
    await page.getByTestId('login-email').fill(ACCOUNTS.superAdmin);
    await page.getByTestId('login-password').fill(E2E_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await snapshot(page, 'platform-rejects-tenant-account');
  });

  test('平台管理者從 apps/platform 登出 → 停在「已登出」頁，再進要重新登入', async ({ page }) => {
    await loginPlatform(page);
    await logout(page);
    await expect(page).toHaveURL(/\/login\?.*signedOut=true/);
    await snapshot(page, 'platform-signed-out');
    // IdP session 已結束：再進 apps/platform 會被帶到登入互動頁
    await page.goto(PLATFORM_URL);
    await expectIdpLogin(page);
  });

  test('外部 IdP 連線在 backstage：auditor 看得到但沒有任何操作按鈕', async ({ page }) => {
    await loginAndWaitForHome(page, 'auditor');
    await openMenuGroup(page, 'menu-group-system');
    await page.getByTestId('menu-identity-provider').click();
    await expect(page.getByTestId('identity-provider-page')).toBeVisible();
    await expect(page.getByTestId('identity-provider-create-button')).toHaveCount(0);
  });

  test('member 沒有外部 IdP 的選單，直接進網址是 403 頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await page.goto('/identity-provider');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
    await expect(page.getByTestId('menu-identity-provider')).toHaveCount(0);
  });
});
