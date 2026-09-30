import { expect, test } from '@playwright/test';

import { expectIdpLogin, loginAndWaitForHome } from '../helpers/auth';

test.describe('路由守衛與選單過濾', () => {
  // ⑤ auditor 直接輸入無權限的網址 → 看到 403 頁（不是被彈回首頁）
  test('auditor 直接進入 /user/create 看到 403 頁，網址保留', async ({ page }) => {
    await loginAndWaitForHome(page, 'auditor');
    await page.goto('/user/create');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
    await expect(page).toHaveURL(/\/user\/create/);
  });

  test('member 沒有任何管理選單，直接打 /role 看到 403', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await expect(page.getByTestId('menu-user')).toHaveCount(0);
    await expect(page.getByTestId('menu-role')).toHaveCount(0);

    await page.goto('/role');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
  });

  test('auditor 看得到唯讀選單，但沒有建立按鈕', async ({ page }) => {
    await loginAndWaitForHome(page, 'auditor');
    await expect(page.getByTestId('menu-user')).toBeVisible();
    await expect(page.getByTestId('menu-auditLog')).toBeVisible();

    await page.goto('/user');
    await expect(page.getByTestId('user-list-page')).toBeVisible();
    await expect(page.getByTestId('user-create-button')).toHaveCount(0);
  });

  test('未登入時進入受保護頁面會被導向 IdP 的登入頁', async ({ page }) => {
    await page.goto('/role');
    await expectIdpLogin(page);
  });
});
