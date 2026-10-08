import { expect, request, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { expectIdpLogin, loginAndWaitForHome } from '../helpers/auth';
import { linkIn, waitForMail } from '../helpers/mailpit';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 使用者的維運（docs/architecture/backend/04-auth.md §3.2、docs/architecture/frontend/03-feature-anatomy.md 的 user feature）：
 * 建立時的重複檢查、編輯與停用、被鎖定後由管理員解鎖、管理員寄出重設密碼信。
 * 帳號都在測試內建立（每個案例自己的 email），不動種子帳號。
 */

const API_URL =
  process.env.E2E_API_URL ?? `${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/api`;
const FIRST_PASSWORD = 'Copper-Meadow-Violet-58';
const RESET_PASSWORD = 'Silver-Canyon-Harbor-91';

const uniqueEmail = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@dev.local`;

interface LoginResult {
  status: number;
  code?: string;
}

async function postLogin(email: string, password: string): Promise<LoginResult> {
  const context = await request.newContext();
  const response = await context.post(`${API_URL}/auth/login`, { data: { email, password } });
  const body = (await response.json()) as { error?: { code?: string } };
  await context.dispose();
  return { status: response.status(), code: body.error?.code };
}

/**
 * 直接登入 api，回傳狀態碼與錯誤碼。第 3 次錯誤之後有漸進延遲（docs/architecture/backend/04-auth.md §3.4）：
 * 被延遲擋下的嘗試（429）不計入鎖定，輪詢到不是 429 為止（延遲會變長，給足時間）。
 */
async function tryLogin(email: string, password: string): Promise<LoginResult> {
  let result: LoginResult = { status: 0 };
  await expect
    .poll(
      async () => {
        result = await postLogin(email, password);
        return result.status;
      },
      { timeout: 30_000 },
    )
    .not.toBe(429);
  return result;
}

/** 管理員建立帳號 → 從啟用信設定密碼：得到一個 active 的帳號。 */
async function createActiveUser(page: Page, token: string, email: string): Promise<string> {
  const created = await apiRequest(token, 'post', '/users', { email, displayName: 'E2E Ops' });
  expect(created.status).toBe(201);
  const mail = await waitForMail(email);
  await page.goto(linkIn(mail, '/setup'));
  await page.getByTestId('setup-password').fill(FIRST_PASSWORD);
  await page.getByTestId('setup-confirm').fill(FIRST_PASSWORD);
  await page.getByTestId('setup-submit').click();
  await expectIdpLogin(page);
  return (created.body as { data: { id: string } }).data.id;
}

test.describe('使用者的維運', () => {
  test('建立使用者時 email 已存在 → 欄位顯示錯誤，對話框留著', async ({ page }) => {
    await loginAndWaitForHome(page, 'admin');
    await page.goto('/user/create');
    const dialog = page.getByTestId('user-create-dialog');
    await dialog.getByTestId('user-email-input').fill('e2e-member@dev.local');
    await dialog.getByTestId('user-display-name-input').fill('E2E Duplicate');
    await dialog.getByTestId('user-create-submit').click();
    await expect(dialog.getByTestId('field-error')).toBeVisible();
    await expect(dialog).toBeVisible();
    await snapshot(page, 'user-email-duplicate');
  });

  test('編輯顯示名稱 → 詳情與列表更新；改成停用要先確認', async ({ page }) => {
    const token = await apiLogin('admin');
    const email = uniqueEmail('e2e-edit');
    // 停用只適用於已啟用的帳號（待啟用的沒有狀態選單）
    const userId = await createActiveUser(page, token, email);
    const renamed = `E2E After ${Date.now()}`;

    await loginAndWaitForHome(page, 'admin');
    await page.goto(`/user/${userId}`);
    const detail = page.getByTestId('user-detail-dialog');
    await detail.getByTestId('user-edit-button').click();
    const form = detail.getByTestId('user-edit-form');
    await form.getByTestId('user-display-name-edit-input').fill(renamed);
    await form.getByTestId('user-status-select').click();
    await getByTestIdAndValue(page, 'select-item', 'inactive').click();
    await form.getByTestId('user-save-button').click();
    await page.getByTestId('user-deactivate-confirm').getByTestId('alert-dialog-confirm').click();
    await expect(detail.getByTestId('user-status-chip')).toBeVisible();
    await expect(detail).toContainText(renamed);
    await snapshot(page, 'user-edited');

    const fetched = await apiRequest(token, 'get', `/users/${userId}`);
    expect((fetched.body as { data: { status: string; displayName: string } }).data).toMatchObject({
      status: 'inactive',
      displayName: renamed,
    });
    await page.goto(`/user?keyword=${encodeURIComponent(email)}`);
    await expect(
      getByTestIdAndValue(page.getByTestId('user-table'), 'table-row', userId),
    ).toContainText(renamed);
  });

  test('連續打錯密碼被鎖定 → 管理員在列表解鎖後可以登入；管理員寄出重設密碼信 → 以新密碼登入', async ({
    page,
    browser,
  }) => {
    // 漸進延遲（§3.4）讓 5 次錯誤要等上十幾秒，加上收兩封信
    test.setTimeout(120_000);
    const token = await apiLogin('admin');
    const email = uniqueEmail('e2e-ops');
    // 不先登入一次：成功登入過的來源（IP）打錯密碼不計入鎖定（docs/architecture/backend/04-auth.md §3.3）
    const userId = await createActiveUser(page, token, email);

    // ① 錯 5 次 → 鎖定：列表的狀態是 locked；鎖定中連正確的密碼也不行（回應與密碼錯誤相同，不透露鎖定）
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 失敗次數要依序累計
      expect((await tryLogin(email, 'Wrong-Password-000')).status).toBe(401);
    }
    const locked = await apiRequest(token, 'get', `/users/${userId}`);
    expect((locked.body as { data: { status: string } }).data.status).toBe('locked');
    expect(await tryLogin(email, FIRST_PASSWORD)).toEqual({
      status: 401,
      code: 'AUTH_INVALID_CREDENTIALS',
    });

    // ② 管理員在列表看到解鎖按鈕 → 解鎖 → 可以登入
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await loginAndWaitForHome(admin, 'admin');
    await admin.goto(`/user?keyword=${encodeURIComponent(email)}`);
    const row = getByTestIdAndValue(admin.getByTestId('user-table'), 'table-row', userId);
    await expect(row.getByTestId('user-unlock-button')).toBeVisible();
    await snapshot(admin, 'user-locked');
    await row.getByTestId('user-unlock-button').click();
    await expect(row.getByTestId('user-unlock-button')).toHaveCount(0);
    expect((await tryLogin(email, FIRST_PASSWORD)).status).toBe(200);

    // ③ 管理員寄出重設密碼信 → 從信設定新密碼 → 舊密碼失效、新密碼可以登入
    const requestedAt = new Date(Date.now() - 1000);
    await row.getByTestId('user-reset-password-button').click();
    await admin
      .getByTestId('user-reset-password-confirm')
      .getByTestId('alert-dialog-confirm')
      .click();
    await expect(getByTestIdAndValue(admin, 'toast', 'success')).toBeVisible();
    await adminContext.close();

    const mail = await waitForMail(email, /密碼/, requestedAt);
    await page.goto(linkIn(mail, '/reset-password'));
    await page.getByTestId('reset-password-new').fill(RESET_PASSWORD);
    await page.getByTestId('reset-password-confirm').fill(RESET_PASSWORD);
    await page.getByTestId('reset-password-submit').click();
    await expectIdpLogin(page);
    expect((await tryLogin(email, FIRST_PASSWORD)).status).toBe(401);
    expect((await tryLogin(email, RESET_PASSWORD)).status).toBe(200);
  });
});
