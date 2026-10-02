import { expect, request, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ACCOUNTS } from '../fixtures/accounts';
import { apiLogin, apiRequest } from '../helpers/api';
import { loginAndWaitForHome } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 回收桶、樂觀鎖與版本紀錄（docs/architecture/backend/14-revisions.md §9）。
 * 資料一律在測試內以 API 建立、名稱帶時間戳，彼此並行也不互相干擾；
 * 角色的持有者用專用帳號 `roleHolder`，不和其他 spec 共用。
 */

interface Created {
  data: { id: string };
}

interface RoleSummary {
  id: string;
  name: string;
  slug: string;
  version: number;
}

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function createUser(token: string): Promise<{ id: string; email: string }> {
  const email = `${unique('e2e-trash')}@dev.local`;
  const created = await apiRequest(token, 'post', '/users', {
    email,
    displayName: `E2E 回收桶 ${Date.now()}`,
  });
  expect(created.status).toBe(201);
  return { id: (created.body as Created).data.id, email };
}

async function createRole(token: string, name: string, permissionKeys: string[]): Promise<string> {
  const created = await apiRequest(token, 'post', '/roles', { name, permissionKeys });
  expect(created.status).toBe(201);
  return (created.body as Created).data.id;
}

async function getRole(token: string, roleId: string): Promise<RoleSummary> {
  const response = await apiRequest(token, 'get', `/roles/${roleId}`);
  expect(response.status).toBe(200);
  return (response.body as { data: RoleSummary }).data;
}

async function rolePermissionKeys(token: string, roleId: string): Promise<string[]> {
  const response = await apiRequest(token, 'get', `/roles/${roleId}/permissions`);
  expect(response.status).toBe(200);
  const body = response.body as { data: { permissions: Array<{ key: string }> } };
  return body.data.permissions.map((permission) => permission.key);
}

/** 登記 → 直傳到 presigned URL → 完成，回傳檔案 id（docs/architecture/backend/09-file.md）。 */
async function uploadTextFile(token: string, folderId: string, name: string): Promise<string> {
  const content = 'E2E 回收桶測試檔';
  const size = Buffer.byteLength(content);
  const registered = await apiRequest(token, 'post', '/files', {
    name,
    contentType: 'text/plain',
    size,
    folderId,
  });
  expect(registered.status).toBe(201);
  const { file, upload } = (
    registered.body as {
      data: { file: { id: string }; upload: { url: string; headers: Record<string, string> } };
    }
  ).data;

  const storage = await request.newContext();
  const put = await storage.put(upload.url, { headers: upload.headers, data: content });
  expect(put.status()).toBe(200);
  await storage.dispose();

  const completed = await apiRequest(token, 'post', `/files/${file.id}/complete`, {});
  expect(completed.status).toBe(200);
  return file.id;
}

/** 使用者列表以 email 篩選到只剩目標那一列。 */
async function gotoUserRow(page: Page, email: string) {
  await page.goto(`/user?keyword=${encodeURIComponent(email)}`);
  await expect(page.getByTestId('user-list-page')).toBeVisible();
  return page.getByTestId('table-row').filter({ hasText: email });
}

test.describe('回收桶（docs/architecture/backend/14-revisions.md §9.2 D6–D10）', () => {
  test('刪除使用者後按提示的「復原」，使用者回到列表', async ({ page }) => {
    const token = await apiLogin('admin');
    const target = await createUser(token);
    await loginAndWaitForHome(page, 'admin');

    const row = await gotoUserRow(page, target.email);
    await expect(row).toHaveCount(1);
    await row.getByTestId('user-delete-button').click();
    await page.getByTestId('user-delete-confirm').getByTestId('alert-dialog-confirm').click();
    await expect(row).toHaveCount(0);
    await snapshot(page, 'user-deleted');

    await getByTestIdAndValue(page, 'toast', 'success').getByTestId('toast-action').click();
    await expect(row).toHaveCount(1);
    await snapshot(page, 'user-undone');

    const detail = await apiRequest(token, 'get', `/users/${target.id}`);
    expect(detail.status).toBe(200);
  });

  test('刪除使用者後從回收桶還原', async ({ page }) => {
    const token = await apiLogin('admin');
    const target = await createUser(token);
    await loginAndWaitForHome(page, 'admin');

    const row = await gotoUserRow(page, target.email);
    await row.getByTestId('user-delete-button').click();
    await page.getByTestId('user-delete-confirm').getByTestId('alert-dialog-confirm').click();
    await expect(row).toHaveCount(0);

    await page.goto('/trash?type=user');
    await expect(page.getByTestId('trash-page')).toBeVisible();
    const restore = getByTestIdAndValue(page, 'user-restore', target.id);
    await expect(restore).toBeVisible();
    await snapshot(page, 'user-in-trash');
    await restore.click();
    await expect(restore).toHaveCount(0);

    const restored = await gotoUserRow(page, target.email);
    await expect(restored).toHaveCount(1);
    await snapshot(page, 'user-restored');
  });

  test('刪除有持有者的角色 → 持有者失去權限；從回收桶還原 → 持有者恢復權限', async ({
    page,
    browser,
  }) => {
    const token = await apiLogin('admin');
    const roleName = unique('E2E 回收桶角色');
    const roleId = await createRole(token, roleName, ['user:read']);
    const users = (await apiRequest(token, 'get', `/users?keyword=${ACCOUNTS.roleHolder}`))
      .body as { data: { items: Array<{ id: string; roles: Array<{ id: string }> }> } };
    const roles = (await apiRequest(token, 'get', '/roles?limit=100')).body as {
      data: { items: RoleSummary[] };
    };
    const memberRole = roles.data.items.find((role) => role.slug === 'member')!;
    const holderUser = users.data.items[0]!;
    // expectedRoleIds 必填（docs/architecture/backend/14-revisions.md §9.2 D4）：以列表上看到的角色為基礎整批取代
    const assigned = await apiRequest(token, 'put', `/users/${holderUser.id}/roles`, {
      roleIds: [roleId, memberRole.id],
      expectedRoleIds: holderUser.roles.map((role) => role.id),
    });
    expect(assigned.status).toBe(200);

    const holderContext = await browser.newContext();
    const holder = await holderContext.newPage();
    await loginAndWaitForHome(holder, 'roleHolder');
    await holder.goto('/user');
    await expect(holder.getByTestId('user-list-page')).toBeVisible();

    // admin 在列表頁刪除：有人持有時確認框直接提供「仍要刪除」
    await loginAndWaitForHome(page, 'admin');
    await page.goto(`/role?keyword=${encodeURIComponent(roleName)}`);
    const row = page.getByTestId('table-row').filter({ hasText: roleName });
    await expect(row).toHaveCount(1);
    await row.getByTestId('role-delete-button').click();
    await page.getByTestId('role-delete-confirm').getByTestId('alert-dialog-confirm').click();
    await expect(row).toHaveCount(0);

    await holder.reload();
    await expect(holder.getByTestId('forbidden-page')).toBeVisible();
    await snapshot(holder, 'holder-lost-permission');

    await page.goto('/trash?type=role');
    const restore = getByTestIdAndValue(page, 'role-restore', roleId);
    await expect(restore).toBeVisible();
    await snapshot(page, 'role-in-trash');
    await restore.click();
    await expect(restore).toHaveCount(0);

    await holder.reload();
    await expect(holder.getByTestId('user-list-page')).toBeVisible();
    await snapshot(holder, 'holder-permission-restored');
    await holderContext.close();
  });

  test('刪除含檔案的資料夾後從回收桶還原，資料夾與檔案都回來', async ({ page }) => {
    const token = await apiLogin('admin');
    const folder = await apiRequest(token, 'post', '/file-folders', {
      name: unique('E2E 回收桶資料夾'),
    });
    expect(folder.status).toBe(201);
    const folderId = (folder.body as Created).data.id;
    const fileId = await uploadTextFile(token, folderId, `${unique('e2e-trash')}.txt`);

    await loginAndWaitForHome(page, 'admin');
    await page.goto('/file');
    const folderItem = getByTestIdAndValue(page, 'file-folder-item', folderId);
    await expect(folderItem).toBeVisible();
    await folderItem.getByTestId('file-item-checkbox').click();
    await page.getByTestId('file-selection-delete').click();
    await page.getByTestId('file-delete-dialog').getByTestId('alert-dialog-confirm').click();
    await expect(folderItem).toHaveCount(0);
    await snapshot(page, 'folder-deleted');

    await page.goto('/trash?type=fileFolder');
    const restore = getByTestIdAndValue(page, 'file-folder-restore', folderId);
    await expect(restore).toBeVisible();
    await snapshot(page, 'folder-in-trash');
    await restore.click();
    await expect(restore).toHaveCount(0);

    await page.goto('/file');
    await expect(getByTestIdAndValue(page, 'file-folder-item', folderId)).toBeVisible();
    await page.goto(`/file?folder=${folderId}`);
    await expect(getByTestIdAndValue(page, 'file-item', fileId)).toBeVisible();
    await snapshot(page, 'folder-restored');
  });
});

test.describe('版本紀錄（docs/architecture/backend/14-revisions.md §9 R5）', () => {
  test('改過角色的名稱與權限後，在版本紀錄看差異並還原到第一版', async ({ page }) => {
    const token = await apiLogin('admin');
    const originalName = unique('E2E 版本角色');
    const renamed = `${originalName} 改名`;
    const roleId = await createRole(token, originalName, ['user:read']);

    // 第 2 版：改名（帶目前的 version）；第 3 版：多一個權限
    const updated = await apiRequest(token, 'patch', `/roles/${roleId}`, {
      name: renamed,
      version: 1,
    });
    expect(updated.status).toBe(200);
    const granted = await apiRequest(token, 'patch', `/roles/${roleId}/permissions`, {
      add: ['role:read'],
      remove: [],
    });
    expect(granted.status).toBe(200);

    await loginAndWaitForHome(page, 'admin');
    await page.goto(`/role/${roleId}`);
    await page.getByTestId('role-revision-button').click();
    const dialog = page.getByTestId('role-revision-dialog');
    await expect(getByTestIdAndValue(dialog, 'role-revision-item', '3')).toBeVisible();

    // 選第 1 版、與目前比較：差異是「還原到這一版會改掉什麼」（目前 → 第 1 版）
    await getByTestIdAndValue(dialog, 'role-revision-item', '1').click();
    const diff = dialog.getByTestId('role-revision-diff');
    const removed = getByTestIdAndValue(diff, 'json-diff-item', 'removed');
    const added = getByTestIdAndValue(diff, 'json-diff-item', 'added');
    await expect(removed.filter({ hasText: renamed })).toHaveCount(1);
    // 帶引號比對：改名後的名稱也以原名開頭
    await expect(added.filter({ hasText: `"${originalName}"` })).toHaveCount(1);
    await expect(removed.filter({ hasText: 'role:read' })).toHaveCount(1);
    await snapshot(page, 'revision-diff');

    await dialog.getByTestId('role-revision-revert').click();
    await page
      .getByTestId('role-revision-revert-confirm')
      .getByTestId('alert-dialog-confirm')
      .click();
    // 還原也是一次修改：多出第 4 版
    await expect(getByTestIdAndValue(dialog, 'role-revision-item', '4')).toBeVisible();
    await snapshot(page, 'revision-reverted');

    const role = await getRole(token, roleId);
    expect(role.name).toBe(originalName);
    expect(await rolePermissionKeys(token, roleId)).toEqual(['user:read']);
  });
});

test.describe('樂觀鎖（docs/architecture/backend/14-revisions.md §9 R1）', () => {
  test('兩個人同時編輯同一個使用者，後送出的看到「已被別人修改」並可重新載入', async ({
    browser,
  }) => {
    const token = await apiLogin('admin');
    const target = await createUser(token);

    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    await loginAndWaitForHome(first, 'admin');
    await loginAndWaitForHome(second, 'admin');

    // 兩邊都先進入編輯，基準版本相同
    const startEditing = async (editor: Page) => {
      await editor.goto(`/user/${target.id}`);
      await editor.getByTestId('user-edit-button').click();
      await expect(editor.getByTestId('user-edit-form')).toBeVisible();
    };
    await Promise.all([startEditing(first), startEditing(second)]);

    const firstName = `先送出 ${Date.now()}`;
    await first.getByTestId('user-display-name-edit-input').fill(firstName);
    await first.getByTestId('user-save-button').click();
    await expect(first.getByTestId('user-edit-form')).toHaveCount(0);

    await second.getByTestId('user-display-name-edit-input').fill(`後送出 ${Date.now()}`);
    await second.getByTestId('user-save-button').click();
    const alert = second.getByTestId('version-conflict-alert');
    await expect(alert).toBeVisible();
    await snapshot(second, 'version-conflict');

    // 重新載入：表單改成以別人存好的內容為基礎
    await alert.getByTestId('version-conflict-reload').click();
    await expect(second.getByTestId('version-conflict-alert')).toHaveCount(0);
    await expect(second.getByTestId('user-display-name-edit-input')).toHaveValue(firstName);

    const detail = await apiRequest(token, 'get', `/users/${target.id}`);
    expect((detail.body as { data: { displayName: string } }).data.displayName).toBe(firstName);

    await firstContext.close();
    await secondContext.close();
  });
});
