import { expect, test } from '@playwright/test';

import { apiLogin, apiRequest, externalRequest } from '../helpers/api';
import { loginAndWaitForHome } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 服務帳號與 API token（docs/architecture/06-external-api.md）：在 backstage 發 token → 以 token 打對外 API
 * （另一個程序，:3001）→ 撤銷後立刻失效。對外 API 只認 token，內部 API 不認 token。
 */

const unique = (prefix: string) => `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const TOKEN_PATTERN = /b2bt_[A-Za-z0-9_]+/;

interface RoleSummary {
  id: string;
  slug: string;
}

async function roleIdOf(token: string, slug: string): Promise<string> {
  const roles = (await apiRequest(token, 'get', '/roles?limit=100')).body as {
    data: { items: RoleSummary[] };
  };
  return roles.data.items.find((role) => role.slug === slug)!.id;
}

async function createServiceAccount(token: string, roleIds: string[]): Promise<string> {
  const created = await apiRequest(token, 'post', '/service-accounts', {
    name: unique('E2E 服務帳號'),
    roleIds,
  });
  expect(created.status).toBe(201);
  return (created.body as { data: { id: string } }).data.id;
}

async function issueToken(
  token: string,
  serviceAccountId: string,
  scopes: string[] | null,
): Promise<string> {
  const created = await apiRequest(token, 'post', `/service-accounts/${serviceAccountId}/tokens`, {
    name: unique('E2E token'),
    expiresInDays: 7,
    scopes,
  });
  expect(created.status).toBe(201);
  return (created.body as { data: { token: string } }).data.token;
}

test.describe('服務帳號與 API token（docs/architecture/06-external-api.md）', () => {
  test('建立服務帳號 → 發 token（只顯示一次）→ 打對外 API → 撤銷後立刻 401', async ({ page }) => {
    const adminToken = await apiLogin('admin');
    const auditorRoleId = await roleIdOf(adminToken, 'auditor');
    const name = unique('E2E 服務帳號');

    // ① 建立服務帳號（指派 auditor 角色）→ 直接進詳情
    await loginAndWaitForHome(page, 'admin');
    await page.goto('/service-account');
    await page.getByTestId('service-account-create-button').click();
    await page.getByTestId('service-account-name-input').fill(name);
    await page.getByTestId('service-account-role-select').click();
    await getByTestIdAndValue(page, 'select-item', auditorRoleId).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('service-account-create-submit').click();
    const detail = page.getByTestId('service-account-detail-dialog');
    await expect(detail.getByTestId('service-account-token-section')).toBeVisible();
    const serviceAccountId = /\/service-account\/([0-9a-f-]+)/.exec(page.url())![1]!;

    // ② 發 token：值只在建立後出現這一次
    await detail.getByTestId('service-account-token-create-button').click();
    const dialog = page.getByTestId('api-token-create-dialog');
    await dialog.getByTestId('api-token-name-input').fill('E2E integration');
    await dialog.getByTestId('api-token-create-submit').click();
    await expect(dialog.getByTestId('api-token-created')).toBeVisible();
    const apiToken = TOKEN_PATTERN.exec(
      (await dialog.getByTestId('api-token-value').textContent()) ?? '',
    )![0];
    await snapshot(page, 'token-shown-once');
    await dialog.getByTestId('api-token-done').click();
    await expect(getByTestIdAndValue(detail, 'api-token-status', 'active')).toBeVisible();

    // ③ 對外 API：以服務帳號的身分、持有 auditor 的權限
    const me = await externalRequest(apiToken, '/v1/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ data: { account: { kind: 'service', name } } });
    expect((await externalRequest(apiToken, '/v1/users')).status).toBe(200);

    // ④ 撤銷 → 下一個請求就失效
    const tokens = (
      await apiRequest(adminToken, 'get', `/service-accounts/${serviceAccountId}/tokens`)
    ).body as { data: { items: Array<{ id: string }> } };
    const tokenId = tokens.data.items[0]!.id;
    await getByTestIdAndValue(detail, 'api-token-revoke-button', tokenId).click();
    await page.getByTestId('api-token-revoke-confirm').getByTestId('alert-dialog-confirm').click();
    await expect(getByTestIdAndValue(detail, 'api-token-status', 'revoked')).toBeVisible();
    await snapshot(page, 'token-revoked');
    expect((await externalRequest(apiToken, '/v1/me')).status).toBe(401);

    await apiRequest(adminToken, 'delete', `/service-accounts/${serviceAccountId}`);
  });

  test('token 的 scopes 再收窄服務帳號的權限：沒列在 scopes 的權限被擋下', async () => {
    const adminToken = await apiLogin('admin');
    const serviceAccountId = await createServiceAccount(adminToken, [
      await roleIdOf(adminToken, 'auditor'),
    ]);
    const scoped = await issueToken(adminToken, serviceAccountId, ['file:read']);

    expect((await externalRequest(scoped, '/v1/me')).status).toBe(200);
    const users = await externalRequest(scoped, '/v1/users');
    expect(users.status).toBe(403);
    expect(users.body).toMatchObject({ error: { code: 'AUTHZ_FORBIDDEN' } });

    await apiRequest(adminToken, 'delete', `/service-accounts/${serviceAccountId}`);
  });

  test('停用服務帳號 → 它的 token 在對外 API 立刻被拒（AUTH_ACCOUNT_DISABLED）', async () => {
    const adminToken = await apiLogin('admin');
    const serviceAccountId = await createServiceAccount(adminToken, [
      await roleIdOf(adminToken, 'auditor'),
    ]);
    const apiToken = await issueToken(adminToken, serviceAccountId, null);
    expect((await externalRequest(apiToken, '/v1/me')).status).toBe(200);

    const current = (await apiRequest(adminToken, 'get', `/service-accounts/${serviceAccountId}`))
      .body as { data: { version: number } };
    const deactivated = await apiRequest(
      adminToken,
      'patch',
      `/service-accounts/${serviceAccountId}`,
      { status: 'inactive', version: current.data.version },
    );
    expect(deactivated.status).toBe(200);
    // 跨程序：停用在內部 api，對外 API 經跨程序的快取失效立即拒絕（docs/architecture/06-external-api.md §9 D16）
    const afterDisable = await externalRequest(apiToken, '/v1/me');
    expect(afterDisable.status).toBe(403);
    expect(afterDisable.body).toMatchObject({ error: { code: 'AUTH_ACCOUNT_DISABLED' } });

    await apiRequest(adminToken, 'delete', `/service-accounts/${serviceAccountId}`);
  });

  test('token 只在對外 API 有效：拿去打內部 API 是 401；對外 API 沒有內部的路由', async () => {
    const adminToken = await apiLogin('admin');
    const serviceAccountId = await createServiceAccount(adminToken, [
      await roleIdOf(adminToken, 'auditor'),
    ]);
    const apiToken = await issueToken(adminToken, serviceAccountId, null);

    expect((await apiRequest(apiToken, 'get', '/users')).status).toBe(401);
    expect((await externalRequest(apiToken, '/users')).status).toBe(404);

    await apiRequest(adminToken, 'delete', `/service-accounts/${serviceAccountId}`);
  });

  test('一般使用者在個人資料頁發個人 token，以本人的身分打對外 API', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await page.goto('/profile');
    await page.getByTestId('profile-api-token-create').click();
    const dialog = page.getByTestId('api-token-create-dialog');
    await dialog.getByTestId('api-token-name-input').fill(unique('E2E 個人 token'));
    await dialog.getByTestId('api-token-create-submit').click();
    const apiToken = TOKEN_PATTERN.exec(
      (await dialog.getByTestId('api-token-value').textContent()) ?? '',
    )![0];
    await dialog.getByTestId('api-token-done').click();
    await snapshot(page, 'personal-token');

    const me = await externalRequest(apiToken, '/v1/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      data: { account: { kind: 'human', email: 'e2e-member@dev.local' } },
    });
    // member 沒有 user:read
    expect((await externalRequest(apiToken, '/v1/users')).status).toBe(403);
  });

  test('auditor 看得到服務帳號，但沒有建立與刪除的操作', async ({ page }) => {
    await loginAndWaitForHome(page, 'auditor');
    await page.goto('/service-account');
    await expect(page.getByTestId('service-account-list-page')).toBeVisible();
    await expect(page.getByTestId('service-account-create-button')).toHaveCount(0);
    await expect(page.getByTestId('service-account-delete-button')).toHaveCount(0);
  });

  test('member 沒有服務帳號選單，直接進網址是 403 頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await expect(page.getByTestId('menu-service-account')).toHaveCount(0);
    await page.goto('/service-account');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
  });
});
