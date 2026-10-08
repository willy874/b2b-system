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
 * 背景工作頁本身的案例也放在這個檔案、依序執行（下方），不會在 feature 關閉的期間打開那一頁。
 */
test.describe.configure({ mode: 'default' });

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

/**
 * 背景工作與稽核日誌的匯出（docs/architecture/backend/10-jobs.md、22-data-transfer.md）：
 * auditor（唯讀角色，但有 `auditLog:export`、`job:read`）匯出稽核日誌 → 背景工作頁看得到那一筆匯出工作與它的工作資料；
 * 平台管理者在 apps/platform 的背景工作頁也看得到同一筆，標出是哪個租戶的。
 */

interface JobSummary {
  id: string;
  name: string;
  state: string;
}

interface JobDetail extends JobSummary {
  data: { transferId?: string } | null;
}

/** 匯出工作的資料只有傳輸 id（§6.3）：逐筆取詳情找到這次的那一筆；其他 spec 同時也在匯出。 */
async function exportJobOf(token: string, transferId: string): Promise<JobDetail | undefined> {
  const list = await apiRequest(token, 'get', '/jobs?name=dataTransfer.export&limit=50');
  const jobs = (list.body as { data: { items: JobSummary[] } }).data.items;
  for (const job of jobs) {
    // oxlint-disable-next-line no-await-in-loop -- 找到就停，多半是最前面幾筆
    const detail = (await apiRequest(token, 'get', `/jobs/${job.id}`)).body as { data: JobDetail };
    if (detail.data.data?.transferId === transferId) return detail.data;
  }
  return undefined;
}

test.describe('背景工作（docs/architecture/backend/10-jobs.md）', () => {
  test('auditor 匯出稽核日誌 → 背景工作頁看得到這次的匯出工作已完成、展開看到工作資料；沒有重試按鈕', async ({
    page,
  }) => {
    const token = await apiLogin('auditor');
    await loginAndWaitForHome(page, 'auditor');

    // ① 稽核日誌 → 匯出（背景產生，完成後自動下載）
    await openMenuGroup(page, 'menu-group-system');
    await page.getByTestId('menu-auditLog').click();
    await page.getByTestId('audit-log-export-button').click();
    const dialog = page.getByTestId('audit-log-export-dialog');
    const download = page.waitForEvent('download');
    await dialog.getByTestId('export-submit').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^audit-logs-\d{8}-\d{4}\.csv$/);

    const transfers = await apiRequest(token, 'get', '/data-transfers?limit=1');
    const transferId = (transfers.body as { data: { items: Array<{ id: string }> } }).data.items[0]!
      .id;
    await expect.poll(async () => (await exportJobOf(token, transferId))?.state).toBe('completed');
    const job = (await exportJobOf(token, transferId))!;

    // ② 背景工作頁：這一筆是已完成，展開看到工作資料裡的傳輸 id
    await page.goto('/job?name=dataTransfer.export');
    const table = page.getByTestId('job-table');
    const row = getByTestIdAndValue(table, 'table-row', job.id);
    await expect(row.getByTestId('job-state')).toHaveAttribute('data-value', 'completed');
    await expect(getByTestIdAndValue(row, 'job-retry', job.id)).toHaveCount(0);
    await getByTestIdAndValue(row, 'job-expand', job.id).click();
    await expect(page.getByTestId('job-detail-data')).toContainText(transferId);
    await snapshot(page, 'job-detail');
  });

  test('平台的背景工作頁列出租戶的工作，標出所屬租戶', async ({ page }) => {
    const token = await apiLogin('auditor');
    const list = await apiRequest(token, 'get', '/jobs?limit=1');
    const latest = (list.body as { data: { items: JobSummary[] } }).data.items[0];
    // 全新的資料庫也有種子與登入觸發的工作；沒有的話沒有東西可比對
    expect(latest).toBeTruthy();

    await loginPlatform(page);
    await page.goto(`${PLATFORM_URL}/job?tenant=default&name=${latest!.name}`);
    const row = getByTestIdAndValue(page.getByTestId('job-table'), 'table-row', latest!.id);
    await expect(row.getByTestId('job-tenant')).toHaveAttribute('data-value', 'default');
    await getByTestIdAndValue(row, 'job-expand', latest!.id).click();
    await expect(page.getByTestId('job-detail')).toBeVisible();
    await snapshot(page, 'platform-job-tenant');
  });

  test('member 沒有背景工作選單，直接進網址是 403 頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await expect(page.getByTestId('menu-job')).toHaveCount(0);
    await page.goto('/job');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
  });
});
