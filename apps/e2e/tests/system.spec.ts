import { expect, test } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { loginAndWaitForHome } from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 系統設定與稽核日誌（docs/architecture/backend/12-settings.md、docs/architecture/iam/02-permission-catalog.md 的 auditLog）：
 * super-admin 改設定 → 重新整理後仍是新值、標示「已覆寫」→ 稽核日誌看得到這次變更與差異。
 * 改的是 `trash.retentionDays`（只影響每天的清除排程），其他並行的 spec 不受影響；結束時還原成預設值。
 */

const SETTING_KEY = 'trash.retentionDays';
const NEW_VALUE = '45';

interface AuditLogItem {
  id: string;
  action: string;
}

test.describe('系統設定（docs/architecture/backend/12-settings.md）', () => {
  test('super-admin 改設定 → 重新整理後保留並標示已覆寫 → 稽核日誌記下差異', async ({ page }) => {
    const token = await apiLogin('superAdmin');
    try {
      await loginAndWaitForHome(page, 'superAdmin');
      await page.goto('/system/settings');
      const field = getByTestIdAndValue(page, 'setting-field', SETTING_KEY);
      await field.getByTestId('setting-number-input').fill(NEW_VALUE);
      await getByTestIdAndValue(page, 'setting-save', 'trash').click();
      await expect(getByTestIdAndValue(page, 'setting-save', 'trash')).toHaveCount(0);

      await page.reload();
      await expect(field.getByTestId('setting-number-input')).toHaveValue(NEW_VALUE);
      await expect(field.getByTestId('setting-overridden')).toBeVisible();
      await snapshot(page, 'setting-overridden');

      // 稽核日誌：同一筆變更，展開看到改了哪個 key
      const logs = await apiRequest(token, 'get', '/audit-logs?action=setting.update&limit=20');
      const latest = (logs.body as { data: { items: AuditLogItem[] } }).data.items[0]!;
      await page.goto('/audit-log?action=setting.update');
      const row = getByTestIdAndValue(page.getByTestId('audit-log-table'), 'table-row', latest.id);
      await row.getByTestId('audit-log-expand').click();
      await expect(page.getByTestId('audit-log-detail-changes')).toContainText(SETTING_KEY);
      await snapshot(page, 'audit-log-detail');
    } finally {
      await apiRequest(token, 'patch', '/system/settings', { values: { [SETTING_KEY]: null } });
    }
  });

  test('設定值超出範圍 → VALIDATION_FAILED，指出是哪個 key', async () => {
    const token = await apiLogin('superAdmin');
    const response = await apiRequest(token, 'patch', '/system/settings', {
      values: { [SETTING_KEY]: 0 },
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { fields: { [`values.${SETTING_KEY}`]: {} } } },
    });
  });

  test('admin 只有 system:read：看得到設定但欄位唯讀，直接打 API 是 403', async ({ page }) => {
    await loginAndWaitForHome(page, 'admin');
    await page.goto('/system/settings');
    await expect(page.getByTestId('setting-page')).toBeVisible();
    await expect(
      getByTestIdAndValue(page, 'setting-field', SETTING_KEY).getByTestId('setting-number-input'),
    ).not.toBeEditable();
    await snapshot(page, 'settings-read-only');

    const token = await apiLogin('admin');
    const response = await apiRequest(token, 'patch', '/system/settings', {
      values: { [SETTING_KEY]: 10 },
    });
    expect(response.status).toBe(403);
  });
});

test.describe('稽核日誌', () => {
  test('建立角色後，稽核日誌以動作篩選找得到這一筆', async ({ page }) => {
    const token = await apiLogin('admin');
    const name = `E2E 稽核 ${Date.now()}`;
    const created = await apiRequest(token, 'post', '/roles', { name, permissionKeys: [] });
    expect(created.status).toBe(201);
    const roleId = (created.body as { data: { id: string } }).data.id;

    const logs = await apiRequest(
      token,
      'get',
      `/audit-logs?action=role.create&resourceId=${roleId}`,
    );
    const items = (logs.body as { data: { items: AuditLogItem[] } }).data.items;
    expect(items).toHaveLength(1);

    await loginAndWaitForHome(page, 'auditor');
    await page.goto('/audit-log?action=role.create');
    await expect(
      getByTestIdAndValue(page.getByTestId('audit-log-table'), 'table-row', items[0]!.id),
    ).toBeVisible();
    await snapshot(page, 'audit-log-filtered');

    await apiRequest(token, 'delete', `/roles/${roleId}?force=true`);
  });

  test('member 沒有稽核日誌與系統設定，直接進網址是 403 頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await expect(page.getByTestId('menu-auditLog')).toHaveCount(0);
    await page.goto('/audit-log');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
    await page.goto('/system/settings');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
  });

  test('側欄只有一個「系統設定」入口：一般、安全性、事件通知、審批流程是同一頁的分頁', async ({
    page,
  }) => {
    await loginAndWaitForHome(page, 'superAdmin');
    await openMenuGroup(page, 'menu-group-system');
    await expect(page.getByTestId('menu-security')).toHaveCount(0);
    await expect(page.getByTestId('menu-notification-event')).toHaveCount(0);
    await expect(page.getByTestId('menu-approval-flow')).toHaveCount(0);
    await page.getByTestId('menu-setting').click();

    // 入口導向第一個分頁
    await expect(page).toHaveURL(/\/system\/settings$/);
    const tabs = page.getByTestId('system-settings-tabs');
    await getByTestIdAndValue(tabs, 'tab', '/system/security').click();
    await expect(page.getByTestId('security-mfa-page')).toBeVisible();
    await getByTestIdAndValue(tabs, 'tab', '/system/notification-events').click();
    await expect(page.getByTestId('notification-event-page')).toBeVisible();
    await getByTestIdAndValue(tabs, 'tab', '/system/approval-flows').click();
    await expect(page.getByTestId('approval-flow-list-page')).toBeVisible();
    await snapshot(page, 'system-settings-tabs');
  });
});
