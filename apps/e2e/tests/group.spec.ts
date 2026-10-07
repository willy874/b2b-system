import { expect, test } from '@playwright/test';

import { ACCOUNTS } from '../fixtures/accounts';
import { apiLogin, apiRequest } from '../helpers/api';
import { loginAndWaitForHome } from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 群組（docs/architecture/iam/07-groups.md）：角色經群組授予成員，成員離開群組就失去權限。
 * 成員用專用帳號 `groupTarget`，它的權限會被增減，不和其他 spec 共用。
 */

interface Created {
  data: { id: string };
}

const unique = (prefix: string) => `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function userIdOf(token: string, email: string): Promise<string> {
  const response = await apiRequest(token, 'get', `/users?keyword=${encodeURIComponent(email)}`);
  expect(response.status).toBe(200);
  return (response.body as { data: { items: Array<{ id: string }> } }).data.items[0]!.id;
}

async function createRole(token: string, name: string, permissionKeys: string[]): Promise<string> {
  const created = await apiRequest(token, 'post', '/roles', { name, permissionKeys });
  expect(created.status).toBe(201);
  return (created.body as Created).data.id;
}

async function createGroup(token: string, name: string): Promise<string> {
  const created = await apiRequest(token, 'post', '/groups', { name });
  expect(created.status).toBe(201);
  return (created.body as Created).data.id;
}

test.describe('群組（docs/architecture/iam/07-groups.md）', () => {
  test('admin 建立群組 → 加入成員、綁定角色 → 成員看得到頁面與權限來源；移出群組後失去權限', async ({
    page,
    browser,
  }) => {
    const token = await apiLogin('admin');
    const roleName = unique('E2E 群組角色');
    const roleId = await createRole(token, roleName, ['user:read']);
    const targetId = await userIdOf(token, ACCOUNTS.groupTarget);
    const groupName = unique('E2E 群組');

    // ① 建立群組：成功後直接開啟詳情
    await loginAndWaitForHome(page, 'admin');
    await page.goto('/group');
    await page.getByTestId('group-create-button').click();
    await page.getByTestId('group-name-input').fill(groupName);
    await page.getByTestId('group-create-submit').click();
    const detail = page.getByTestId('group-detail-dialog');
    await expect(detail).toBeVisible();
    const groupId = /\/group\/([0-9a-f-]+)/.exec(page.url())![1]!;

    // ② 加入成員（使用者在伺服器端搜尋）
    await detail.getByTestId('group-member-target').click();
    await page.getByTestId('select-search').fill(ACCOUNTS.groupTarget);
    await getByTestIdAndValue(page, 'select-item', targetId).click();
    await detail.getByTestId('group-member-add').click();
    await expect(getByTestIdAndValue(detail, 'group-member', targetId)).toBeVisible();

    // ③ 綁定角色
    await detail.getByTestId('group-role-select').click();
    await page.getByTestId('select-search').fill(roleName);
    await getByTestIdAndValue(page, 'select-item', roleId).click();
    await page.keyboard.press('Escape');
    await detail.getByTestId('group-save-roles-button').click();
    await expect(detail.getByTestId('group-save-roles-button')).toBeDisabled();
    await snapshot(page, 'group-configured');

    // ④ 成員登入：經群組拿到 user:read，權限來源列出群組這一段
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await loginAndWaitForHome(memberPage, 'groupTarget');
    await openMenuGroup(memberPage, 'menu-group-people');
    await expect(memberPage.getByTestId('menu-user')).toBeVisible();
    await memberPage.goto('/profile');
    await memberPage.getByTestId('profile-permission-sources-show').click();
    // 清單點 user:read，右側顯示它的來源
    await getByTestIdAndValue(memberPage, 'permission-source', 'user:read').click();
    const path = memberPage
      .getByTestId('permission-source-viewer')
      .getByTestId('explain-path')
      .filter({ hasText: groupName });
    await expect(getByTestIdAndValue(path, 'explain-node', 'group')).toHaveText(groupName);
    // 成員沒有 role:read：路徑上的角色只顯示種類（docs/architecture/iam/08-explain.md §2 的遮蔽）
    await expect(getByTestIdAndValue(path, 'explain-node', 'role')).toHaveAttribute(
      'data-hidden',
      'true',
    );
    await snapshot(memberPage, 'permission-via-group');

    // ⑤ 移出群組 → 重新整理後失去權限
    const removed = await apiRequest(token, 'patch', `/groups/${groupId}/members`, {
      add: [],
      remove: [{ type: 'user', id: targetId }],
    });
    expect(removed.status).toBe(200);
    await memberPage.goto('/user');
    await expect(memberPage.getByTestId('forbidden-page')).toBeVisible();
    await snapshot(memberPage, 'removed-from-group');
    await memberContext.close();

    await apiRequest(token, 'delete', `/groups/${groupId}`);
    await apiRequest(token, 'delete', `/roles/${roleId}?force=true`);
  });

  test('巢狀群組：子群組的成員也拿到父群組的角色', async () => {
    const token = await apiLogin('admin');
    const roleId = await createRole(token, unique('E2E 巢狀角色'), ['role:read']);
    const parentId = await createGroup(token, unique('E2E 父群組'));
    const childId = await createGroup(token, unique('E2E 子群組'));
    const targetId = await userIdOf(token, ACCOUNTS.groupTarget);

    const bound = await apiRequest(token, 'patch', `/groups/${parentId}/roles`, {
      add: [roleId],
      remove: [],
    });
    expect(bound.status).toBe(200);
    const nested = await apiRequest(token, 'patch', `/groups/${parentId}/members`, {
      add: [{ type: 'group', id: childId }],
      remove: [],
    });
    expect(nested.status).toBe(200);
    const joined = await apiRequest(token, 'patch', `/groups/${childId}/members`, {
      add: [{ type: 'user', id: targetId }],
      remove: [],
    });
    expect(joined.status).toBe(200);

    const memberToken = await apiLogin('groupTarget');
    expect((await apiRequest(memberToken, 'get', `/roles/${roleId}`)).status).toBe(200);

    // 父群組含子群組時，再把父群組加進子群組會形成循環
    const cycle = await apiRequest(token, 'patch', `/groups/${childId}/members`, {
      add: [{ type: 'group', id: parentId }],
      remove: [],
    });
    expect(cycle.status).toBe(409);
    expect(cycle.body).toMatchObject({ error: { code: 'GROUP_MEMBERSHIP_CYCLE' } });

    await apiRequest(token, 'delete', `/groups/${childId}`);
    expect((await apiRequest(memberToken, 'get', `/roles/${roleId}`)).status).toBe(403);

    await apiRequest(token, 'delete', `/groups/${parentId}`);
    await apiRequest(token, 'delete', `/roles/${roleId}?force=true`);
  });

  test('不能把自己加進群組（AUTHZ_SELF_MODIFY）', async () => {
    const token = await apiLogin('admin');
    const groupId = await createGroup(token, unique('E2E 自己'));
    const adminId = await userIdOf(token, ACCOUNTS.admin);

    const response = await apiRequest(token, 'patch', `/groups/${groupId}/members`, {
      add: [{ type: 'user', id: adminId }],
      remove: [],
    });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'AUTHZ_SELF_MODIFY' } });

    await apiRequest(token, 'delete', `/groups/${groupId}`);
  });

  test('auditor 看得到群組，但沒有建立、刪除、加成員與綁角色的操作', async ({ page }) => {
    const token = await apiLogin('admin');
    const groupId = await createGroup(token, unique('E2E 唯讀群組'));

    await loginAndWaitForHome(page, 'auditor');
    await page.goto('/group');
    await expect(page.getByTestId('group-list-page')).toBeVisible();
    await expect(page.getByTestId('group-create-button')).toHaveCount(0);
    await expect(page.getByTestId('group-delete-button')).toHaveCount(0);

    await page.goto(`/group/${groupId}`);
    const detail = page.getByTestId('group-detail-dialog');
    await expect(detail.getByTestId('group-member-list')).toBeVisible();
    await expect(detail.getByTestId('group-edit-button')).toHaveCount(0);
    await expect(detail.getByTestId('group-role-picker')).toHaveCount(0);
    await expect(detail.getByTestId('group-member-add')).toHaveCount(0);
    await snapshot(page, 'auditor-read-only');

    await page.goto('/group/create');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();

    await apiRequest(token, 'delete', `/groups/${groupId}`);
  });

  test('member 沒有群組選單，直接進網址是 403 頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await expect(page.getByTestId('menu-group')).toHaveCount(0);
    await page.goto('/group');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
  });
});
