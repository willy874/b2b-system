import { expect, test } from '@playwright/test';

import { loginAndWaitForHome } from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { snapshot } from '../helpers/snapshot';

// M2 的元件真的被接進 app 裡（不是只有單元測試通過）

test('稽核日誌的日期篩選在表頭的篩選面板內選取，選取後會寫進網址', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');
  await page.goto('/audit-log');
  await expect(page.getByTestId('audit-log-page')).toBeVisible();

  await page.getByTestId('audit-log-table').getByTestId('filter-bar-trigger').click();
  const rangePicker = page.getByTestId('filter-bar-date-range');
  await rangePicker.click();
  const firstDay = page
    .getByTestId('calendar-day')
    .and(page.locator(':not([data-disabled])'))
    .nth(10);
  const picked = await firstDay.getAttribute('data-value');
  if (!picked) throw new Error('calendar-day 缺少 data-value');
  await firstDay.click();
  // 篩選面板只改草稿，按「搜尋」才寫進網址
  await page.getByTestId('filter-bar-submit').click();

  await expect(page).toHaveURL(new RegExp(`from=${picked}`));
  await page.getByTestId('audit-log-table').getByTestId('filter-bar-trigger').click();
  await expect(rangePicker).toContainText(picked);
  await snapshot(page, 'date-range-filter');
});

test('側邊選單有圖示', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');
  await openMenuGroup(page, 'menu-group-people');
  await expect(page.getByTestId('menu-role').locator('svg')).toBeVisible();
});

test('側邊選單預設只展開當前頁面所在的分類，父選單可收合', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');
  await page.goto('/role');
  await expect(page.getByTestId('role-list-page')).toBeVisible();

  const people = page.getByTestId('menu-group-people');
  const system = page.getByTestId('menu-group-system');
  await expect(people).toHaveAttribute('aria-expanded', 'true');
  await expect(system).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('menu-role')).toBeVisible();
  await expect(page.getByTestId('menu-auditLog')).toBeHidden();

  await people.click();
  await expect(people).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('menu-role')).toBeHidden();

  // 換到別的分類的頁面：回到預設，只展開新頁面所在的分類
  await openMenuGroup(page, 'menu-group-system');
  await page.getByTestId('menu-auditLog').click();
  await expect(page.getByTestId('audit-log-page')).toBeVisible();
  await expect(system).toHaveAttribute('aria-expanded', 'true');
  await expect(people).toHaveAttribute('aria-expanded', 'false');
  await snapshot(page, 'menu-follows-page');
});
