import { expect, test } from '@playwright/test';

import { loginAndWaitForHome } from '../helpers/auth';

// M2 的元件真的被接進 app 裡（不是只有單元測試通過）

test('稽核日誌的日期篩選使用 DateRangePicker，選取後會寫進網址', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');
  await page.goto('/audit-log');
  await expect(page.getByTestId('audit-log-page')).toBeVisible();

  await page.getByTestId('audit-log-range').click();
  const firstDay = page.locator('[data-testid^="calendar-day-"]:not([data-disabled])').nth(10);
  const value = await firstDay.getAttribute('data-testid');
  await firstDay.click();

  const picked = value!.replace('calendar-day-', '');
  await expect(page).toHaveURL(new RegExp(`from=${picked}`));
  await expect(page.getByTestId('audit-log-range')).toContainText(picked);
});

test('側邊選單有圖示', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');
  await expect(page.getByTestId('menu-role').locator('svg')).toBeVisible();
});
