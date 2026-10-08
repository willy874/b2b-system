import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { loginAndWaitForHome } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 匯入／匯出（docs/architecture/backend/22-data-transfer.md）：匯出 CSV 並檢查下載的內容；
 * 上傳有錯誤的檔案 → 在表格修正 → 重新整理後從草稿接續 → 套用 → 結果。使用者在測試內建立，不影響其他 spec。
 */

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe('匯入／匯出（docs/architecture/backend/22-data-transfer.md）', () => {
  test('匯出使用者 CSV：背景產生後自動下載，內容是匯出者語系的標頭', async ({ page }) => {
    const token = await apiLogin('admin');
    const email = `${unique('e2e-export')}@dev.local`;
    expect(
      (await apiRequest(token, 'post', '/users', { email, displayName: '=E2E Export' })).status,
    ).toBe(201);

    await loginAndWaitForHome(page, 'admin');
    await page.goto(`/user?keyword=${encodeURIComponent(email)}`);
    await page.getByTestId('user-export-button').click();
    const dialog = page.getByTestId('user-export-dialog');
    await expect(dialog).toBeVisible();
    await snapshot(page, 'export-dialog');

    const download = page.waitForEvent('download');
    await dialog.getByTestId('export-submit').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^users-\d{8}-\d{4}\.csv$/);
    const text = await readFile(await file.path(), 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('ID,Email,帳號,顯示名稱,狀態');
    // 公式注入防護：開頭是 = 的字串前置 '
    expect(text).toContain(`${email},,'=E2E Export,待啟用`);

    // 我的匯入匯出：剛才的匯出在列表上
    await page.goto('/data-transfer');
    await expect(page.getByTestId('data-transfer-table')).toContainText('.csv');
  });

  test('匯入使用者：修正錯誤的儲存格 → 重新整理後從草稿接續 → 套用 → 結果', async ({ page }) => {
    const first = `${unique('e2e-import-a')}@dev.local`;
    const second = `${unique('e2e-import-b')}@dev.local`;
    const csv = `﻿顯示名稱,Email\r\nImport A,${first}\r\nImport B,not-an-email\r\n`;

    await loginAndWaitForHome(page, 'admin');
    await page.goto('/user/import');
    await page.getByTestId('file-upload-input').setInputFiles({
      name: 'users.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    await page.getByTestId('import-analyze').click();

    const grid = page.getByTestId('import-grid');
    await expect(grid).toBeVisible();
    await expect(page.getByTestId('import-summary')).toContainText('1 列錯誤');
    await expect(grid.getByText('not-an-email')).toHaveAttribute('aria-invalid', 'true');
    await snapshot(page, 'import-preview-with-error');

    // 在表格裡修正：雙擊進入編輯、輸入、Enter
    await grid.getByText('not-an-email').dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(second);
    await page.keyboard.press('Enter');
    // 驗證中的列不算錯誤：等這一輪驗證結束再看摘要
    await expect(page.getByTestId('import-validating')).toBeHidden();
    await expect(page.getByTestId('import-summary')).toContainText('0 列錯誤');

    // 重新整理：預覽存成加密的草稿（節流 2 秒），可以接續。等修正後的草稿真的寫進 IndexedDB 再重新整理
    // （分析完那一刻就存過一次；只看「有草稿」會在修正存進去之前就重新整理）
    const editedAt = await page.evaluate(() => Date.now());
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            // 還沒建立前不能自己 open：會建出沒有 object store 的空資料庫，app 之後就升級不了
            const exists = (await indexedDB.databases()).some(
              (item) => item.name === 'b2b-system:import-drafts',
            );
            if (!exists) return 0;
            return new Promise<number>((resolve) => {
              const open = indexedDB.open('b2b-system:import-drafts', 1);
              open.onsuccess = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains('drafts')) return resolve(0);
                const all = db.transaction('drafts').objectStore('drafts').getAll();
                all.onsuccess = () =>
                  resolve(
                    Math.max(
                      0,
                      ...(all.result as Array<{ savedAt?: number }>).map(
                        (item) => item.savedAt ?? 0,
                      ),
                    ),
                  );
              };
              open.onerror = () => resolve(0);
            });
          }),
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(editedAt);
    page.on('dialog', (dialog) => void dialog.accept());
    await page.reload();
    await page.getByTestId('import-draft-resume').click();
    await expect(page.getByTestId('import-grid')).toContainText(second);
    // 接續後全部列重新驗證
    await expect(page.getByTestId('import-validating')).toBeHidden();
    await expect(page.getByTestId('import-summary')).toContainText('0 列錯誤');

    await page.getByTestId('import-submit').click();
    await page.getByTestId('import-submit-confirm').click();
    const result = page.getByTestId('import-result');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(getByTestIdAndValue(page, 'import-result-succeeded', '2')).toBeVisible();
    await snapshot(page, 'import-result');

    const token = await apiLogin('admin');
    const found = await apiRequest(token, 'get', `/users?keyword=${encodeURIComponent(second)}`);
    expect(
      (found.body as { data: { items: Array<{ email: string; status: string }> } }).data.items,
    ).toEqual([expect.objectContaining({ email: second, status: 'pending' })]);
  });

  test('匯入部門：上層引用同一份檔案裡的其他列，子部門寫在上層之前也依序建立（§7.8）', async ({
    page,
  }) => {
    const suffix = `${Date.now()}`.slice(-8);
    const root = `E2E-HQ-${suffix}`;
    const child = `E2E-SALES-${suffix}`;
    const csv = `\uFEFF代碼,名稱,上層\r\n${child},業務部 ${suffix},${root}\r\n${root},總部 ${suffix},\r\n`;

    await loginAndWaitForHome(page, 'admin');
    await page.goto('/organization/import');
    await page.getByTestId('file-upload-input').setInputFiles({
      name: 'units.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    await page.getByTestId('import-analyze').click();
    await expect(page.getByTestId('import-grid')).toBeVisible();
    await expect(page.getByTestId('import-validating')).toBeHidden();
    await expect(page.getByTestId('import-summary')).toContainText('0 列錯誤');

    await page.getByTestId('import-submit').click();
    await page.getByTestId('import-submit-confirm').click();
    await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 30_000 });
    await expect(getByTestIdAndValue(page, 'import-result-succeeded', '2')).toBeVisible();

    const token = await apiLogin('admin');
    const tree = await apiRequest(token, 'get', `/org-units?keyword=${encodeURIComponent(suffix)}`);
    const units = (
      tree.body as {
        data: { items: Array<{ id: string; code: string | null; parentId: string | null }> };
      }
    ).data.items;
    const parent = units.find((unit) => unit.code === root);
    expect(units.find((unit) => unit.code === child)?.parentId).toBe(parent?.id);
  });
  test('匯出角色 CSV：權限鍵以分號串在同一格', async ({ page }) => {
    const token = await apiLogin('admin');
    const name = unique('E2E 匯出角色');
    const created = await apiRequest(token, 'post', '/roles', {
      name,
      permissionKeys: ['user:read', 'role:read'],
    });
    expect(created.status).toBe(201);
    const roleId = (created.body as { data: { id: string } }).data.id;

    try {
      await loginAndWaitForHome(page, 'admin');
      await page.goto(`/role?keyword=${encodeURIComponent(name)}`);
      await page.getByTestId('role-export-button').click();
      const download = page.waitForEvent('download');
      await page.getByTestId('role-export-dialog').getByTestId('export-submit').click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/^roles-\d{8}-\d{4}\.csv$/);
      const text = await readFile(await file.path(), 'utf8');
      const line = text.split('\r\n').find((row) => row.includes(name));
      expect(line).toBeDefined();
      expect(line).toMatch(/role:read;user:read|user:read;role:read/);
    } finally {
      await apiRequest(token, 'delete', `/roles/${roleId}?force=true`);
    }
  });

  test('匯入角色：含自己沒有的權限鍵的列被標成錯誤（反提權）；略過錯誤列套用 → 只建立合法的那一列', async ({
    page,
  }) => {
    const allowed = unique('E2E 匯入角色');
    const escalated = unique('E2E 提權角色');
    // admin 只有 system:read（docs/architecture/backend/12-settings.md）：授予 system:update 是提權
    const csv = `\uFEFF名稱,權限\r\n${allowed},user:read\r\n${escalated},system:update\r\n`;

    await loginAndWaitForHome(page, 'admin');
    await page.goto('/role/import');
    await page.getByTestId('file-upload-input').setInputFiles({
      name: 'roles.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    await page.getByTestId('import-analyze').click();
    await expect(page.getByTestId('import-grid')).toBeVisible();
    await expect(page.getByTestId('import-validating')).toBeHidden();
    await expect(page.getByTestId('import-summary')).toContainText('1 列錯誤');
    await snapshot(page, 'role-import-escalation');

    await page.getByTestId('import-submit').click();
    const dialog = page.getByTestId('import-submit-dialog');
    await expect(getByTestIdAndValue(dialog, 'import-submit-errors', '1')).toBeVisible();
    await dialog.getByTestId('import-skip-invalid').click();
    await dialog.getByTestId('import-submit-confirm').click();
    await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 30_000 });
    await expect(getByTestIdAndValue(page, 'import-result-succeeded', '1')).toBeVisible();

    const token = await apiLogin('admin');
    const roles = async (keyword: string) =>
      (
        (await apiRequest(token, 'get', `/roles?keyword=${encodeURIComponent(keyword)}`)).body as {
          data: { items: Array<{ id: string; name: string }> };
        }
      ).data.items;
    const [created] = await roles(allowed);
    expect(created?.name).toBe(allowed);
    expect(await roles(escalated)).toEqual([]);
    await apiRequest(token, 'delete', `/roles/${created!.id}?force=true`);
  });
});
