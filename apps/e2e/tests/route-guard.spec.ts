import { expect, test } from '@playwright/test';

import { expectIdpLogin, loginAndWaitForHome } from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { snapshot } from '../helpers/snapshot';

test.describe('路由守衛與選單過濾', () => {
  // ⑤ auditor 直接輸入無權限的網址 → 看到 403 頁（不是被彈回首頁）
  test('auditor 直接進入 /user/create 看到 403 頁，網址保留', async ({ page }) => {
    await loginAndWaitForHome(page, 'auditor');
    await page.goto('/user/create');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
    await expect(page).toHaveURL(/\/user\/create/);
    await snapshot(page, 'forbidden');
  });

  // 路徑分大小寫（docs/architecture/frontend/04-routing.md §4）：大小寫不符的網址是 404，不會繞過 403 頁打開對話框
  test('auditor 直接進入 /User/create 看到 404 頁，不會打開建立使用者的對話框', async ({
    page,
  }) => {
    await loginAndWaitForHome(page, 'auditor');
    await page.goto('/User/create');
    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByTestId('user-create-dialog')).toHaveCount(0);
  });

  test('member 沒有任何管理選單，直接打 /role 看到 403', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await expect(page.getByTestId('menu-user')).toHaveCount(0);
    await expect(page.getByTestId('menu-role')).toHaveCount(0);

    await page.goto('/role');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
  });

  test('member 直接打 /ROLE 看到 404 頁，不會出現角色列表的外框', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await page.goto('/ROLE');
    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByTestId('role-list-page')).toHaveCount(0);
  });

  test('auditor 看得到唯讀選單，但沒有建立按鈕', async ({ page }) => {
    await loginAndWaitForHome(page, 'auditor');
    await openMenuGroup(page, 'menu-group-people');
    await expect(page.getByTestId('menu-user')).toBeVisible();
    await openMenuGroup(page, 'menu-group-system');
    await expect(page.getByTestId('menu-auditLog')).toBeVisible();

    await page.goto('/user');
    await expect(page.getByTestId('user-list-page')).toBeVisible();
    await expect(page.getByTestId('user-create-button')).toHaveCount(0);
    await snapshot(page, 'read-only-user-list');
  });

  test('未登入時進入受保護頁面會被導向 IdP 的登入頁', async ({ page }) => {
    await page.goto('/role');
    await expectIdpLogin(page);
    await snapshot(page, 'idp-login');
  });
});
