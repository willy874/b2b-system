import { expect, test } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { loginAndWaitForHome } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 標籤（docs/architecture/backend/18-tag.md）：管理頁建立 → 在使用者詳情貼上 → 使用者列表以標籤篩選；
 * 刪除標籤後，貼過的地方一起消失。使用者在測試內以 API 建立，不影響其他 spec。
 */

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function tagIdOf(token: string, name: string): Promise<string> {
  const response = await apiRequest(token, 'get', '/tags?scope=user');
  expect(response.status).toBe(200);
  const tags = (response.body as { data: { items: Array<{ id: string; name: string }> } }).data;
  return tags.items.find((tag) => tag.name === name)!.id;
}

test.describe('標籤（docs/architecture/backend/18-tag.md）', () => {
  test('建立使用者標籤 → 貼到使用者 → 列表以標籤篩選；刪除標籤後一起消失', async ({ page }) => {
    const token = await apiLogin('admin');
    const email = `${unique('e2e-tagged')}@dev.local`;
    const created = await apiRequest(token, 'post', '/users', { email, displayName: 'E2E Tagged' });
    expect(created.status).toBe(201);
    const userId = (created.body as { data: { id: string } }).data.id;
    const tagName = unique('E2E');

    // ① 管理頁：切到「使用者」分頁建立標籤
    await loginAndWaitForHome(page, 'admin');
    await page.goto('/tag');
    await getByTestIdAndValue(page.getByTestId('tag-scope-tabs'), 'tab', 'user').click();
    await page.getByTestId('tag-create-button').click();
    const form = page.getByTestId('tag-form-dialog');
    await form.getByTestId('tag-name-input').fill(tagName);
    await form.getByTestId('tag-color-select').click();
    await getByTestIdAndValue(page, 'select-item', 'success').click();
    await form.getByTestId('tag-form-submit').click();
    await expect(form).toHaveCount(0);
    const tagId = await tagIdOf(token, tagName);
    await expect(
      getByTestIdAndValue(page.getByTestId('tag-table'), 'table-row', tagId),
    ).toBeVisible();
    await snapshot(page, 'tag-created');

    // ② 使用者詳情：貼上標籤
    await page.goto(`/user/${userId}`);
    const detail = page.getByTestId('user-detail-dialog');
    await detail.getByTestId('user-tag-edit-button').click();
    const assign = page.getByTestId('tag-assign-dialog');
    await assign.getByTestId('tag-assign-select').click();
    await getByTestIdAndValue(page, 'select-item', tagId).click();
    await page.keyboard.press('Escape');
    await assign.getByTestId('tag-assign-save').click();
    await expect(
      getByTestIdAndValue(detail.getByTestId('user-tags'), 'tag-chip', tagId),
    ).toBeVisible();

    // ③ 使用者列表以標籤篩選：只剩這一位
    await page.goto(`/user?tagId=${tagId}`);
    await expect(page.getByTestId('user-list-page')).toBeVisible();
    const rows = page.getByTestId('table-row');
    await expect(rows).toHaveCount(1);
    await expect(getByTestIdAndValue(page, 'table-row', userId)).toBeVisible();
    await expect(getByTestIdAndValue(rows.first(), 'tag-chip', tagId)).toBeVisible();
    await snapshot(page, 'filtered-by-tag');

    // ④ 刪除標籤 → 使用者身上的標籤一起移除
    await page.goto('/tag?scope=user');
    await getByTestIdAndValue(page, 'tag-delete-button', tagId).click();
    await page.getByTestId('tag-delete-confirm').getByTestId('alert-dialog-confirm').click();
    await expect(getByTestIdAndValue(page, 'table-row', tagId)).toHaveCount(0);
    await page.goto(`/user/${userId}`);
    await expect(
      page.getByTestId('user-detail-dialog').getByTestId('user-tag-section'),
    ).toBeVisible();
    await expect(page.locator(`[data-testid="tag-chip"][data-value="${tagId}"]`)).toHaveCount(0);

    await apiRequest(token, 'delete', `/users/${userId}`);
  });

  test('同一個分類下標籤名稱不能重複（TAG_NAME_DUPLICATE）', async () => {
    const token = await apiLogin('admin');
    const name = unique('E2E 重複');
    const first = await apiRequest(token, 'post', '/tags', { scope: 'user', name });
    expect(first.status).toBe(201);
    const second = await apiRequest(token, 'post', '/tags', { scope: 'user', name });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'TAG_NAME_DUPLICATE' } });
    await apiRequest(token, 'delete', `/tags/${(first.body as { data: { id: string } }).data.id}`);
  });

  test('auditor 沒有標籤管理的選單，直接進網址是 403 頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'auditor');
    await expect(page.getByTestId('menu-tag')).toHaveCount(0);
    await page.goto('/tag');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
  });
});
