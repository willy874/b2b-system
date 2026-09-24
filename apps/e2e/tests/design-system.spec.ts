import { expect, test } from '@playwright/test';

import { loginAndWaitForHome } from '../helpers/auth';

// M2 的元件真的被接進 app 裡（不是只有單元測試通過）

test('稽核日誌的日期篩選使用 DateRangePicker，選取後會寫進網址', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');
  await page.goto('/audit-log');
  await expect(page.getByTestId('audit-log-page')).toBeVisible();

  await page.getByTestId('audit-log-range').click();
  const firstDay = page.getByTestId('calendar-day').and(page.locator(':not([disabled])')).nth(10);
  const picked = await firstDay.getAttribute('data-value');
  if (!picked) throw new Error('calendar-day 缺少 data-value');
  await firstDay.click();

  await expect(page).toHaveURL(new RegExp(`from=${picked}`));
  await expect(page.getByTestId('audit-log-range')).toContainText(picked);
});

test('側邊選單有圖示', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');
  await expect(page.getByTestId('menu-role').locator('svg')).toBeVisible();
});
