import { expect, test } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { PLATFORM_URL, loginAndWaitForHome, loginPlatform } from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 平台可關閉的 feature（docs/architecture/05-tenancy.md §12）：平台管理者在 apps/platform 關掉租戶的某個 feature →
 * 停在那一頁的 backstage 使用者被推播帶回首頁、選單消失、端點回 FEATURE_DISABLED；再打開後恢復。
 * 用「背景工作」（`job`）：其他 spec 不碰它的頁面與端點，關掉也不會停掉背景工作本身（§12 的表）。
 */
test.describe('平台可關閉的 feature（docs/architecture/05-tenancy.md §12）', () => {
  test('關閉租戶的「背景工作」→ backstage 的頁面與選單消失、端點 404；重新打開後恢復', async ({
    browser,
  }) => {
    // backstage：admin 停在背景工作頁
    const tenantContext = await browser.newContext();
    const tenantPage = await tenantContext.newPage();
    await loginAndWaitForHome(tenantPage, 'admin');
    await tenantPage.goto('/job');
    await expect(tenantPage.getByTestId('job-page')).toBeVisible();
    await expect(tenantPage.getByTestId('realtime-status')).toHaveAttribute(
      'data-value',
      'connected',
    );
    const adminToken = await apiLogin('admin');

    // apps/platform：預設租戶 → 功能 → 取消勾選「背景工作」→ 確認
    const platformContext = await browser.newContext();
    const platform = await platformContext.newPage();
    await loginPlatform(platform);
    await platform.goto(`${PLATFORM_URL}/tenant`);
    await getByTestIdAndValue(platform, 'tenant-link', 'default').click();
    await getByTestIdAndValue(platform, 'tab', 'features').click();
    const jobFeature = getByTestIdAndValue(platform, 'tenant-feature', 'job');
    const toggle = jobFeature.getByTestId('tenant-feature-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await platform.getByTestId('tenant-feature-dialog').getByTestId('alert-dialog-confirm').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await snapshot(platform, 'feature-disabled');

    try {
      // 推播 → backstage 移除 plugin：停在頁面上的人回到首頁、選單沒有這一項
      await expect(tenantPage.getByTestId('home-page')).toBeVisible();
      await openMenuGroup(tenantPage, 'menu-group-system');
      await expect(tenantPage.getByTestId('menu-job')).toHaveCount(0);
      await snapshot(tenantPage, 'backstage-without-job');

      const disabled = await apiRequest(adminToken, 'get', '/jobs/queues');
      expect(disabled.status).toBe(404);
      expect(disabled.body).toMatchObject({ error: { code: 'FEATURE_DISABLED' } });

      // 直接輸入網址：路由不存在
      await tenantPage.goto('/job');
      await expect(tenantPage.getByTestId('not-found-page')).toBeVisible();
    } finally {
      // 重新打開（不需確認）：其他測試與重跑的起點一致
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
    }

    await expect
      .poll(async () => (await apiRequest(adminToken, 'get', '/jobs/queues')).status)
      .toBe(200);
    await tenantPage.goto('/job');
    await expect(tenantPage.getByTestId('job-page')).toBeVisible();

    await platformContext.close();
    await tenantContext.close();
  });

  test('租戶的使用者打不到平台的端點（PLATFORM_ONLY）', async () => {
    const token = await apiLogin('superAdmin');
    const response = await apiRequest(token, 'get', '/platform/tenants');
    // 租戶網域上的平台端點一律當作不存在（不透露平台 API 的位置）
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'PLATFORM_ONLY' } });
  });
});
