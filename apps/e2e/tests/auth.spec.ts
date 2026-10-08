import { expect, test } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD, PLATFORM_ADMIN } from '../fixtures/accounts';
import {
  PLATFORM_URL,
  expectIdpLogin,
  expectSignedOut,
  login,
  loginAndWaitForHome,
  logout,
} from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

test.describe('認證流程', () => {
  // ① 登入 → 首頁 → 登出
  test('登入後進入首頁，登出後停在「已登出」頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'superAdmin');
    await openMenuGroup(page, 'menu-group-people');
    await expect(page.getByTestId('menu-role')).toBeVisible();
    await snapshot(page, 'home');

    await logout(page);
    await expectSignedOut(page);
    await snapshot(page, 'signed-out');
  });

  // 身分分屬租戶與平台（docs/architecture/05-tenancy.md §10.2 D5、D9）：租戶帳號的 IdP session
  // 不能直接進 apps/platform；以平台管理者登入 apps/platform 之後，backstage 仍維持登入
  test('租戶的使用者打開 apps/platform 要以平台管理者重新登入；backstage 不受影響', async ({
    page,
  }) => {
    await loginAndWaitForHome(page, 'superAdmin');

    await page.goto(PLATFORM_URL);
    await expectIdpLogin(page);
    await page.getByTestId('login-email').fill(PLATFORM_ADMIN);
    await page.getByTestId('login-password').fill(E2E_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('home-display-name')).toHaveText('E2E Platform Admin');
    await snapshot(page, 'platform-home');
    await expect(page).toHaveURL(`${PLATFORM_URL}/`);

    await page.goto('/');
    await expect(page.getByTestId('home-page')).toBeVisible();
    await logout(page);
    await expectSignedOut(page);
  });

  // 登出的後端撤銷失敗（docs/architecture/04-sso.md §3.4）：不能假裝已登出——IdP session 還在，下一個人會被直接登入。
  // 重試以 refresh cookie 完成後，IdP session 也結束了：再次登入要重新輸入密碼
  test('登出請求失敗 → 已登出頁警示並可重試；重試成功後再次登入要重新輸入密碼', async ({
    page,
  }) => {
    await loginAndWaitForHome(page, 'superAdmin');
    await page.route('**/api/auth/logout', (route) => route.abort());

    await logout(page);
    await expect(page.getByTestId('logout-incomplete')).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login\?.*logout=incomplete/);
    await snapshot(page, 'logout-incomplete');

    await page.unroute('**/api/auth/logout');
    await page.getByTestId('logout-retry').click();
    await expect(page.getByTestId('logout-incomplete')).toHaveCount(0);
    await expectSignedOut(page);

    await page.getByTestId('login-sso').click();
    await expectIdpLogin(page);
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

  // ② 錯誤密碼 5 次 → 帳號鎖定：鎖定中連正確的密碼也不能登入，而且不透露密碼對錯（backend/04-auth.md §3.2）
  // 第 3 次錯誤之後有漸進延遲（§3.4）：被延遲擋下的嘗試（429）不計入鎖定，等 Retry-After 之後重送
  test('連續 5 次錯誤密碼後帳號被鎖定', async ({ page }) => {
    const attempt = async (password?: string) => {
      for (;;) {
        // 登入互動頁送出的是 POST /api/oidc-interaction/:uid/login（不是 backstage 的 /auth/login 頁面）
        const response = page.waitForResponse(
          (res) =>
            res.request().method() === 'POST' &&
            /\/oidc-interaction\/[^/]+\/login$/.test(res.url()),
        );
        await login(page, 'lockTarget', password);
        const res = await response;
        if (res.status() !== 429) return;
        await page.waitForTimeout(Number(res.headers()['retry-after'] ?? '1') * 1000);
      }
    };
    for (let count = 1; count <= 5; count += 1) {
      await attempt('WrongPassword!1');
      await expect(page.getByTestId('login-error')).toBeVisible();
    }
    await attempt();
    await expect(
      getByTestIdAndValue(page, 'login-error', 'AUTH_INVALID_CREDENTIALS'),
    ).toBeVisible();
    await snapshot(page, 'account-locked');
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
    await snapshot(second, 'second-tab-after-reload');

    await context.close();
  });
});
