import { expect, test } from '@playwright/test';

import { ACCOUNTS } from '../fixtures/accounts';
import { apiLogin, apiRequest } from '../helpers/api';
import { expectIdpLogin, loginAndWaitForHome } from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { getByTestIdAndValue } from '../helpers/selectors';

const ROLE_NAME = `E2E 檢視者 ${Date.now()}`;

test.describe('RBAC 生命週期', () => {
  // ③ admin 建立角色（含權限）→ 指派給使用者 → 該使用者登入後看得到對應選單
  test('建立角色 → 指派 → 目標使用者看得到對應選單與頁面', async ({ page, browser }) => {
    await loginAndWaitForHome(page, 'admin');

    // 建立角色（含 user:read）
    await page.goto('/role');
    await page.getByTestId('role-create-button').click();
    await page.getByTestId('role-name-input').fill(ROLE_NAME);
    await getByTestIdAndValue(page, 'permission-checkbox', 'user:read').click();
    await page.getByTestId('role-create-submit').click();
    await expect(page.getByTestId('role-list-page')).toContainText(ROLE_NAME);

    // 指派給 member
    const token = await apiLogin('admin');
    const list = (await apiRequest(token, 'get', '/users?keyword=e2e-member')).body as {
      data: { items: Array<{ id: string }> };
    };
    const memberId = list.data.items[0]!.id;
    const roles = (await apiRequest(token, 'get', '/roles?limit=100')).body as {
      data: { items: Array<{ id: string; name: string; slug: string }> };
    };
    const newRole = roles.data.items.find((role) => role.name === ROLE_NAME)!;
    const memberRole = roles.data.items.find((role) => role.slug === 'member')!;
    const assigned = await apiRequest(token, 'put', `/users/${memberId}/roles`, {
      roleIds: [newRole.id, memberRole.id],
    });
    expect(assigned.status).toBe(200);

    // member 重新登入後看得到使用者選單
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await loginAndWaitForHome(memberPage, 'member');
    await openMenuGroup(memberPage, 'menu-group-people');
    await expect(memberPage.getByTestId('menu-user')).toBeVisible();
    await memberPage.goto('/user');
    await expect(memberPage.getByTestId('user-list-page')).toBeVisible();

    // ④ 移除該角色的權限 → 持有者重新整理後對應的選單與頁面消失
    const removed = await apiRequest(token, 'patch', `/roles/${newRole.id}/permissions`, {
      add: [],
      remove: ['user:read'],
    });
    expect(removed.status).toBe(200);

    await memberPage.reload();
    await expect(memberPage.getByTestId('forbidden-page')).toBeVisible();
    await memberPage.goto('/');
    await expect(memberPage.getByTestId('menu-user')).toHaveCount(0);

    await memberContext.close();

    // 清理
    await apiRequest(token, 'delete', `/roles/${newRole.id}?force=true`);
  });

  // ⑥ 反提權：admin 嘗試授予自己沒有的權限 → 被擋下
  test('反提權：未持有的權限在挑選器中是 disabled', async ({ page }) => {
    await loginAndWaitForHome(page, 'admin');
    await page.goto('/role');
    await page.getByTestId('role-create-button').click();

    // admin 沒有 system:update
    await expect(getByTestIdAndValue(page, 'permission-checkbox', 'system:update')).toBeDisabled();
    // 但有 user:read
    await expect(getByTestIdAndValue(page, 'permission-checkbox', 'user:read')).toBeEnabled();
  });

  test('反提權：直接打 API 也會被擋下（AUTHZ_ESCALATION）', async () => {
    const token = await apiLogin('admin');
    const response = await apiRequest(token, 'post', '/roles', {
      name: `提權測試 ${Date.now()}`,
      permissionKeys: ['system:update'],
    });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'AUTHZ_ESCALATION' } });
  });

  // ⑩ 系統角色的刪除按鈕被 disable
  test('系統角色的刪除按鈕是 disabled，直接打 API 回 ROLE_SYSTEM_PROTECTED', async ({ page }) => {
    await loginAndWaitForHome(page, 'admin');
    await page.goto('/role');
    await expect(page.getByTestId('role-list-page')).toBeVisible();

    const systemRow = page.getByTestId('table-row').filter({ hasText: '系統管理員' }).first();
    // 停用的理由在 Tooltip 裡，所以按鈕保持可聚焦：用 aria-disabled 而非原生 disabled
    await expect(systemRow.getByTestId('role-delete-button')).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    const token = await apiLogin('admin');
    const roles = (await apiRequest(token, 'get', '/roles?limit=100')).body as {
      data: { items: Array<{ id: string; slug: string }> };
    };
    const adminRole = roles.data.items.find((role) => role.slug === 'admin')!;
    const response = await apiRequest(token, 'delete', `/roles/${adminRole.id}`);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'ROLE_SYSTEM_PROTECTED' } });
  });

  // ⑦ 使用者被停用 → 其開著的分頁下一次操作被登出
  test('使用者被停用後，開著的分頁下一次操作被登出', async ({ browser }) => {
    const adminToken = await apiLogin('superAdmin');

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAndWaitForHome(page, 'disableTarget');

    const victimToken = await apiLogin('disableTarget');
    const users = (await apiRequest(adminToken, 'get', `/users?keyword=${ACCOUNTS.disableTarget}`))
      .body as { data: { items: Array<{ id: string }> } };
    const victimId = users.data.items[0]!.id;

    const disabled = await apiRequest(adminToken, 'patch', `/users/${victimId}`, {
      status: 'inactive',
    });
    expect(disabled.status).toBe(200);

    // 既有 access token 立刻失效（不等 UserCache 的 30 秒 TTL）
    const afterDisable = await apiRequest(victimToken, 'get', '/auth/profile');
    expect([401, 403]).toContain(afterDisable.status);

    // UI：下一次操作被導回登入頁（IdP 的 session 也一起結束，不會被直接登回來）
    await page.goto('/profile');
    await expectIdpLogin(page);

    await context.close();
  });
});

test.describe('i18n', () => {
  // ⑨ 切換語系 → 已造訪的頁面文字全部跟著換
  test('切換語系後，已造訪頁面的文字跟著換', async ({ page }) => {
    await loginAndWaitForHome(page, 'superAdmin');
    await page.goto('/role');
    await expect(page.getByTestId('role-list-page')).toContainText('角色');

    await page.goto('/preference');
    await page.getByTestId('preference-locale').click();
    await page.getByRole('option', { name: 'English' }).click();

    await page.goto('/role');
    await expect(page.getByTestId('role-list-page')).toContainText('Roles');
    await expect(page.getByTestId('menu-user')).toContainText('Users');
  });
});
