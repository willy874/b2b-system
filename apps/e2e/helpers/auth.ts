import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD, PLATFORM_ADMIN } from '../fixtures/accounts';
import type { AccountKey } from '../fixtures/accounts';
import { getByTestIdAndValue } from './selectors';

/** apps/auth（IdP 的登入互動頁所在的 origin，docs/adr/0019-sso-identity-platform.md）。 */
export const AUTH_URL = process.env.E2E_AUTH_URL ?? 'http://localhost:5175';

/**
 * 登入走 SSO：backstage 的 `/auth/login` 頂層跳轉到 apps/auth 的互動頁，登入後帶授權碼跳回 backstage。
 * 互動頁的 testid 與原本的登入頁相同，Playwright 會跟著跳轉等到元素出現。
 */
export async function login(
  page: Page,
  account: AccountKey,
  password = E2E_PASSWORD,
): Promise<void> {
  await page.goto('/auth/login');
  await page.getByTestId('login-email').fill(ACCOUNTS[account]);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

export async function loginAndWaitForHome(page: Page, account: AccountKey): Promise<void> {
  await login(page, account);
  await expect(page.getByTestId('home-page')).toBeVisible();
}

/**
 * 平台管理者登入 apps/auth（沒有租戶的授權，docs/adr/0020-physical-tenant-isolation.md D5、D8）：
 * apps/auth 的 `/login` 跳到 IdP，互動頁對平台 DB 驗證。
 */
export async function loginPlatform(page: Page): Promise<void> {
  await page.goto(AUTH_URL);
  await expectIdpLogin(page);
  await page.getByTestId('login-email').fill(PLATFORM_ADMIN);
  await page.getByTestId('login-password').fill(E2E_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-display-name')).toBeVisible();
}

/** 沒有 session 時被導到 IdP 的登入互動頁（網址已經不在 backstage）。 */
export async function expectIdpLogin(page: Page): Promise<void> {
  await expect(page.getByTestId('login-email')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`^${AUTH_URL}/interaction/`));
}

/** 登出後停在「已登出」頁：單一登出之後不自動跳到 IdP。 */
export async function expectSignedOut(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/auth\/login\?.*signedOut=true/);
  await expect(page.getByTestId('login-sso')).toBeVisible();
}

export async function logout(page: Page): Promise<void> {
  await page.getByTestId('account-menu-trigger').click();
  await getByTestIdAndValue(page, 'menu-item', 'logout').click();
}
