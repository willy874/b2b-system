import { expect, test } from '@playwright/test';

import { ACCOUNTS } from '../fixtures/accounts';
import { AUTH_URL, expectSignedOut, login, loginAndWaitForHome, logout } from '../helpers/auth';

test.describe('認證流程', () => {
  // ① 登入 → 首頁 → 登出
  test('登入後進入首頁，登出後停在「已登出」頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'superAdmin');
    await expect(page.getByTestId('menu-role')).toBeVisible();

    await logout(page);
    await expectSignedOut(page);
  });

  // SSO（docs/adr/0019-sso-identity-platform.md）：登入一次，兩個產品都能用；任一個登出，兩邊一起結束
  test('在 backstage 登入後打開 apps/auth 不必再登入；從 backstage 登出後 apps/auth 也登出', async ({
    page,
  }) => {
    await loginAndWaitForHome(page, 'superAdmin');

    await page.goto(AUTH_URL);
    await expect(page.getByTestId('home-display-name')).toBeVisible();
    await expect(page).toHaveURL(`${AUTH_URL}/`);

    await page.goto('/');
    await expect(page.getByTestId('home-page')).toBeVisible();
    await logout(page);
    await expectSignedOut(page);

    await page.goto(AUTH_URL);
    await expect(page).toHaveURL(/\/login\?.*signedOut=true/);
  });

  test('access token 不進 localStorage（只有 session 旗標）', async ({ page }) => {
    await loginAndWaitForHome(page, 'superAdmin');
    const dump = await page.evaluate(() => JSON.stringify(globalThis.localStorage));
    expect(dump).not.toContain('eyJ'); // JWT 的開頭
    expect(dump).toContain('hasSession');
  });

  test('重新整理後自動續期，不需要重新登入', async ({ page }) => {
    await loginAndWaitForHome(page, 'superAdmin');
    await page.reload();
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page).not.toHaveURL(/\/auth\/login/);
  });

  // ② 錯誤密碼 5 次 → 帳號鎖定
  test('連續 5 次錯誤密碼後帳號被鎖定', async ({ page }) => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await login(page, 'lockTarget', 'WrongPassword!1');
      await expect(page.getByTestId('login-error')).toBeVisible();
    }
    await login(page, 'lockTarget');
    await expect(page.getByTestId('login-error')).toContainText(/鎖定|locked/i);
  });
});

test.describe('跨分頁協調', () => {
  // ⑧ 兩個分頁同時操作 → 不會因 token 輪替而被登出
  test('兩個分頁同時操作不會互相踢掉對方', async ({ browser }) => {
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();

    await first.goto('/auth/login');
    await first.getByTestId('login-email').fill(ACCOUNTS.superAdmin);
    await first.getByTestId('login-password').fill('E2E!Password123');
    await first.getByTestId('login-submit').click();
    await expect(first.getByTestId('home-page')).toBeVisible();

    await second.goto('/role');
    await expect(second.getByTestId('role-list-page')).toBeVisible();

    // 兩邊同時重新整理：兩個分頁依序續期（Web Locks 互斥），不會拿同一個舊 cookie
    await Promise.all([first.reload(), second.reload()]);
    await expect(first.getByTestId('home-page')).toBeVisible();
    await expect(second.getByTestId('role-list-page')).toBeVisible();

    await context.close();
  });
});
