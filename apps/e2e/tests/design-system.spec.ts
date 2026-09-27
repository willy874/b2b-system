import { expect, test } from '@playwright/test';

import { loginAndWaitForHome } from '../helpers/auth';

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
});

test('側邊選單有圖示', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');
  await expect(page.getByTestId('menu-role').locator('svg')).toBeVisible();
});
