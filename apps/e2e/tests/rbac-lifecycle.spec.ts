import { expect, test } from '@playwright/test';

import { ACCOUNTS } from '../fixtures/accounts';
import { apiLogin, apiRequest } from '../helpers/api';
import { expectIdpLogin, loginAndWaitForHome } from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

const ROLE_NAME = `E2E 檢視者 ${Date.now()}`;

/** 使用者列表的一列：`expectedRoleIds`（必填，ADR-0025 D4）以列表上看到的角色為基礎。 */
interface UserWithRoles {
  id: string;
  roles: Array<{ id: string }>;
}

/** 建立只有 user:read 的角色並指派給 revokeTarget；回傳移除權限與清理用的 id。 */
async function grantUserRead(token: string): Promise<{ roleId: string }> {
  const created = await apiRequest(token, 'post', '/roles', {
    name: `E2E 撤銷 ${Date.now()}`,
    permissionKeys: ['user:read'],
  });
  expect(created.status).toBe(201);
  const roleId = (created.body as { data: { id: string } }).data.id;

  const users = (await apiRequest(token, 'get', `/users?keyword=${ACCOUNTS.revokeTarget}`))
    .body as { data: { items: UserWithRoles[] } };
  const roles = (await apiRequest(token, 'get', '/roles?limit=100')).body as {
    data: { items: Array<{ id: string; slug: string }> };
  };
  const memberRole = roles.data.items.find((role) => role.slug === 'member')!;
  const target = users.data.items[0]!;
  const assigned = await apiRequest(token, 'put', `/users/${target.id}/roles`, {
    roleIds: [roleId, memberRole.id],
    expectedRoleIds: target.roles.map((role) => role.id),
  });
  expect(assigned.status).toBe(200);
  return { roleId };
}

async function revokeUserRead(token: string, roleId: string): Promise<void> {
  const removed = await apiRequest(token, 'patch', `/roles/${roleId}/permissions`, {
    add: [],
    remove: ['user:read'],
  });
  expect(removed.status).toBe(200);
}

test.describe('RBAC 生命週期', () => {
  // ③ admin 建立角色（含權限）→ 指派給使用者 → 該使用者登入後看得到對應選單
  test('建立角色 → 指派 → 目標使用者看得到對應選單與頁面', async ({ page, browser }) => {
    await loginAndWaitForHome(page, 'admin');

    // 建立角色（含 user:read）
    await page.goto('/role');
    await page.getByTestId('role-create-button').click();
    await page.getByTestId('role-name-input').fill(ROLE_NAME);
    await page.getByTestId('role-permission-select').click();
    await page.getByTestId('select-search').fill('user:read');
    await getByTestIdAndValue(page, 'role-permission-option', 'user:read').click();
    await page.keyboard.press('Escape');
    await page.getByTestId('role-create-submit').click();
    await expect(page.getByTestId('role-list-page')).toContainText(ROLE_NAME);
    await snapshot(page, 'role-created');

    // 指派給 member
    const token = await apiLogin('admin');
    const list = (await apiRequest(token, 'get', '/users?keyword=e2e-member')).body as {
      data: { items: UserWithRoles[] };
    };
    const member = list.data.items[0]!;
    const roles = (await apiRequest(token, 'get', '/roles?limit=100')).body as {
      data: { items: Array<{ id: string; name: string; slug: string }> };
    };
    const newRole = roles.data.items.find((role) => role.name === ROLE_NAME)!;
    const memberRole = roles.data.items.find((role) => role.slug === 'member')!;
    const assigned = await apiRequest(token, 'put', `/users/${member.id}/roles`, {
      roleIds: [newRole.id, memberRole.id],
      expectedRoleIds: member.roles.map((role) => role.id),
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
    await snapshot(memberPage, 'member-granted');

    // ④ 移除該角色的權限 → 持有者重新整理後對應的選單與頁面消失
    const removed = await apiRequest(token, 'patch', `/roles/${newRole.id}/permissions`, {
      add: [],
      remove: ['user:read'],
    });
    expect(removed.status).toBe(200);

    await memberPage.reload();
    await expect(memberPage.getByTestId('forbidden-page')).toBeVisible();
    await snapshot(memberPage, 'member-revoked');
    await memberPage.goto('/');
    await expect(memberPage.getByTestId('menu-user')).toHaveCount(0);

    await memberContext.close();

    // 清理
    await apiRequest(token, 'delete', `/roles/${newRole.id}?force=true`);
  });

  // ⑥ 反提權：admin 嘗試授予自己沒有的權限 → 被擋下
  test('反提權：未持有的權限在下拉選單與技能樹中都是 disabled', async ({ page }) => {
    await loginAndWaitForHome(page, 'admin');
    await page.goto('/role');
    await page.getByTestId('role-create-button').click();

    // 下拉選單：admin 沒有 system:update
    await page.getByTestId('role-permission-select').click();
    // 選項多時會虛擬捲動：先搜尋，讓目標列一定在畫面上
    await page.getByTestId('select-search').fill('system:update');
    await expect(
      getByTestIdAndValue(page, 'role-permission-option', 'system:update'),
    ).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');

    // 技能樹（預設收合）
    await page.getByTestId('role-permission-tree-toggle').click();
    await expect(getByTestIdAndValue(page, 'role-permission-node', 'system:update')).toBeDisabled();
    // 但有 user:read
    await expect(getByTestIdAndValue(page, 'role-permission-node', 'user:read')).toBeEnabled();
    await snapshot(page, 'escalation-disabled');
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
    await snapshot(page, 'system-role-protected');

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
      .body as { data: { items: Array<{ id: string; version: number }> } };
    const victim = users.data.items[0]!;

    // version 必填（樂觀鎖，ADR-0025 D4）：帶列表上看到的版本
    const disabled = await apiRequest(adminToken, 'patch', `/users/${victim.id}`, {
      status: 'inactive',
      version: victim.version,
    });
    expect(disabled.status).toBe(200);

    // 既有 access token 立刻失效（不等 UserCache 的 30 秒 TTL）
    const afterDisable = await apiRequest(victimToken, 'get', '/auth/profile');
    expect([401, 403]).toContain(afterDisable.status);

    // UI：下一次操作被導回登入頁（IdP 的 session 也一起結束，不會被直接登回來）
    await page.goto('/profile');
    await expectIdpLogin(page);
    await snapshot(page, 'disabled-user-signed-out');

    await context.close();
  });
});

// 權限在使用中被撤銷：持有者不重新整理，畫面也要跟上後端（docs/architecture/backend/08-realtime.md §6.1、
// apps/backstage/src/app/GlobalProvider.tsx 的 PermissionDriftWatcher）
test.describe('權限在使用中被撤銷', () => {
  // 兩個案例都會整批改寫同一個帳號的角色
  test.describe.configure({ mode: 'serial' });

  test('即時推播：停在列表頁的持有者不重新整理，頁面也變成 403、選單消失', async ({ page }) => {
    const token = await apiLogin('admin');
    const { roleId } = await grantUserRead(token);

    await loginAndWaitForHome(page, 'revokeTarget');
    await page.goto('/user');
    await expect(page.getByTestId('user-list-page')).toBeVisible();
    await expect(page.getByTestId('menu-user')).toBeVisible();
    // 整頁載入後的第一次連線不會 resync：撤銷若落在「取得 profile 之後、連上之前」就只能靠下一個案例的 403 兜底
    await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-value', 'connected');

    await revokeUserRead(token, roleId);

    // rolePermission 的變更推給持有者的 user room → 前端重新取得 profile → 路由守衛改顯示 403
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
    await expect(page.getByTestId('menu-user')).toHaveCount(0);
    await snapshot(page, 'revoked-by-push');

    await apiRequest(token, 'delete', `/roles/${roleId}?force=true`);
  });

  test('推播漏掉時，下一次操作收到 403 → 提示權限已變更並自我修正', async ({ page }) => {
    const token = await apiLogin('admin');
    const { roleId } = await grantUserRead(token);

    // 攔下 WebSocket 且不接到伺服器：模擬斷線或程序在提交後、推播前重啟
    await page.routeWebSocket(/\/api\/socket\.io\//, () => {});
    await loginAndWaitForHome(page, 'revokeTarget');
    await page.goto('/user');
    await expect(page.getByTestId('user-list-page')).toBeVisible();
    await expect(page.getByTestId('table-row').first()).toBeVisible();
    await expect(page.getByTestId('menu-user')).toBeVisible();
    await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-value', 'disconnected');

    await revokeUserRead(token, roleId);
    // 沒有推播：畫面停在原本的列表
    await expect(page.getByTestId('user-list-page')).toBeVisible();

    // 下一次操作（開啟使用者詳情）→ API 回 AUTHZ_FORBIDDEN → 提示並重新取得 profile
    await page.getByTestId('table-row').first().dblclick();
    await expect(getByTestIdAndValue(page, 'toast', 'warning')).toBeVisible();
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
    await expect(page.getByTestId('menu-user')).toHaveCount(0);
    await snapshot(page, 'revoked-by-drift');

    await apiRequest(token, 'delete', `/roles/${roleId}?force=true`);
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
    await snapshot(page, 'english');
  });
});
