import { expect, test } from '@playwright/test';

import { PLATFORM_URL, loginPlatform } from '../helpers/auth';
import { fetchOn } from '../helpers/browser-fetch';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * apps/platform 的租戶管理（docs/architecture/05-tenancy.md）：網域的新增與移除會立刻改變租戶的解析，
 * 並記入平台的稽核日誌；用量分頁與列表的用量欄位（§5.4）。只動預設租戶的「別名」網域，
 * 主要網域（登入、信中連結用的那一個）不碰，其他 spec 不受影響。
 */

const WEB_URL = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173');

test.describe('平台的租戶管理（docs/architecture/05-tenancy.md）', () => {
  test('預設租戶加一個別名網域 → 從那個網域解析得到租戶 → 移除後解析不到；兩次都記入平台稽核日誌', async ({
    page,
    browser,
  }) => {
    const alias = `e2e-alias-${Date.now().toString(36)}.localhost:${WEB_URL.port}`;
    const aliasOrigin = `http://${alias}`;

    await loginPlatform(page);
    await page.goto(`${PLATFORM_URL}/tenant`);
    await getByTestIdAndValue(page, 'tenant-link', 'default').click();
    const overview = page.getByTestId('tenant-overview');
    await expect(overview.getByTestId('tenant-domain-primary')).toBeVisible();

    // ① 新增網域 → 列在網域清單；從那個網域打 api 解析得到預設租戶
    await overview.getByTestId('tenant-domain-input').fill(alias);
    await overview.getByTestId('tenant-domain-add').click();
    await expect(getByTestIdAndValue(overview, 'tenant-domain', alias)).toBeVisible();
    await snapshot(page, 'tenant-domain-added');
    let removed = false;
    try {
      await expect
        .poll(async () => (await fetchOn(browser, aliasOrigin, '/tenant/current')).status)
        .toBe(200);

      // ② 移除（要確認）→ 從那個網域解析不到任何租戶
      await getByTestIdAndValue(overview, 'tenant-domain-remove', alias).click();
      await page
        .getByTestId('tenant-domain-remove-dialog')
        .getByTestId('alert-dialog-confirm')
        .click();
      await expect(getByTestIdAndValue(overview, 'tenant-domain', alias)).toHaveCount(0);
      removed = true;
      await expect
        .poll(async () => (await fetchOn(browser, aliasOrigin, '/tenant/current')).code)
        .toBe('TENANT_NOT_FOUND');
    } finally {
      if (!removed) {
        await getByTestIdAndValue(overview, 'tenant-domain-remove', alias).click();
        await page
          .getByTestId('tenant-domain-remove-dialog')
          .getByTestId('alert-dialog-confirm')
          .click();
      }
    }

    // ③ 平台稽核日誌：新增與移除各一筆（最新的在最上面），展開看得到網域
    const expectAudited = async (action: string) => {
      await page.goto(`${PLATFORM_URL}/audit-log?action=${action}`);
      const table = page.getByTestId('audit-log-table');
      await expect(table.getByTestId('audit-log-action').first()).toHaveAttribute(
        'data-value',
        action,
      );
      await table.getByTestId('audit-log-expand').first().click();
      await expect(page.getByTestId('audit-log-metadata')).toContainText(alias);
    };
    await expectAudited('tenant.domain.add');
    await expectAudited('tenant.domain.remove');
    await snapshot(page, 'platform-audit-domain');
  });

  test('主要網域沒有移除按鈕（TENANT_PRIMARY_DOMAIN 由 api 整合測試守住）', async ({ page }) => {
    await loginPlatform(page);
    await page.goto(`${PLATFORM_URL}/tenant`);
    await getByTestIdAndValue(page, 'tenant-link', 'default').click();
    const overview = page.getByTestId('tenant-overview');
    const primary = overview.getByTestId('tenant-domain-primary');
    await expect(primary).toBeVisible();
    const primaryDomain = await overview
      .locator('[data-testid="tenant-domain"]')
      .first()
      .getAttribute('data-value');
    expect(primaryDomain).toBeTruthy();
    await expect(getByTestIdAndValue(overview, 'tenant-domain-remove', primaryDomain!)).toHaveCount(
      0,
    );

    await snapshot(page, 'tenant-primary-domain');
  });

  test('用量分頁：統計卡與 30 天的趨勢表；列表可以依用量欄位排序', async ({ page }) => {
    await loginPlatform(page);
    await page.goto(`${PLATFORM_URL}/tenant`);
    await getByTestIdAndValue(page, 'tenant-link', 'default').click();
    await getByTestIdAndValue(page, 'tab', 'usage').click();
    await expect(page).toHaveURL(/tab=usage/);
    const usage = page.getByTestId('tenant-usage');
    await expect(usage.getByTestId('tenant-usage-snapshot')).toBeVisible();
    await expect(usage.getByTestId('tenant-usage-users')).toBeVisible();
    await expect(usage.getByTestId('tenant-usage-requests')).toBeVisible();
    await expect(usage.getByTestId('tenant-usage-trend').getByTestId('table-row')).toHaveCount(30);
    await snapshot(page, 'tenant-usage');

    // 列表：點「近期請求」的表頭排序，排序寫進網址
    await page.goto(`${PLATFORM_URL}/tenant`);
    await page.locator('th[data-column-id="recentRequests"] button').click();
    await expect(page).toHaveURL(/sort=/);
    await expect(page.locator('th[data-column-id="recentRequests"]')).toHaveAttribute(
      'aria-sort',
      /ascending|descending/,
    );
    await expect(getByTestIdAndValue(page, 'tenant-link', 'default')).toBeVisible();
  });
});
