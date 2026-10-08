import { expect, request, test } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD } from '../fixtures/accounts';
import { apiLogin, apiRequest } from '../helpers/api';
import { PLATFORM_URL, expectIdpLogin, loginAndWaitForHome } from '../helpers/auth';
import { linkIn, waitForMail } from '../helpers/mailpit';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 個人帳號的密碼與憑證（docs/architecture/backend/04-auth.md）：改密碼後所有裝置登出、忘記密碼不洩漏帳號是否存在、
 * 從重設信設定新密碼、重放舊的 refresh token 撤銷整條 family（docs/features/roadmap.md M3）。
 * 密碼會被改掉的案例用專用帳號 `passwordTarget`，依序執行並在結束時改回 `E2E_PASSWORD`。
 */

// 密碼政策會擋常見密碼的字根與 email／顯示名稱的片段（modules/credential）
const NEW_PASSWORD = 'Kq7!vNz3#pLw9x';
const API_URL = `${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/api`;

/** 以目前的密碼登入後把密碼改回 `E2E_PASSWORD`，讓重跑與其他案例的起點一致。 */
async function restorePassword(current: string): Promise<void> {
  const context = await request.newContext();
  const login = await context.post(`${API_URL}/auth/login`, {
    data: { email: ACCOUNTS.passwordTarget, password: current },
  });
  expect(login.status()).toBe(200);
  const { accessToken } = ((await login.json()) as { data: { accessToken: string } }).data;
  const changed = await context.post(`${API_URL}/auth/change-password`, {
    headers: { authorization: `Bearer ${accessToken}` },
    data: { currentPassword: current, newPassword: E2E_PASSWORD },
  });
  expect(changed.status()).toBeLessThan(300);
  await context.dispose();
}

async function loginStatus(email: string, password: string): Promise<number> {
  const context = await request.newContext();
  const response = await context.post(`${API_URL}/auth/login`, { data: { email, password } });
  await context.dispose();
  return response.status();
}

test.describe('改密碼與忘記密碼', () => {
  test.describe.configure({ mode: 'serial' });

  test('在個人資料頁改密碼 → 所有裝置登出 → 舊密碼失效、新密碼可以登入', async ({ page }) => {
    await loginAndWaitForHome(page, 'passwordTarget');
    await page.goto('/profile');
    await page.getByTestId('profile-current-password').fill(E2E_PASSWORD);
    await page.getByTestId('profile-new-password').fill(NEW_PASSWORD);
    await page.getByTestId('profile-confirm-password').fill(NEW_PASSWORD);
    await page.getByTestId('profile-change-password').click();
    await page
      .getByTestId('profile-change-password-confirm')
      .getByTestId('alert-dialog-confirm')
      .click();

    // session.revoked 推播比回應先到也一樣是 password_changed（SessionStore.expectSessionEnd）
    await expect(page).toHaveURL(/\/auth\/login\?.*signedOut=true.*reason=password_changed/);
    await expect(page.getByTestId('login-sso')).toBeVisible();
    await snapshot(page, 'signed-out-after-change');

    expect(await loginStatus(ACCOUNTS.passwordTarget, E2E_PASSWORD)).toBe(401);
    expect(await loginStatus(ACCOUNTS.passwordTarget, NEW_PASSWORD)).toBe(200);
    await restorePassword(NEW_PASSWORD);
  });

  test('目前的密碼打錯 → 欄位下方顯示錯誤，仍維持登入', async ({ page }) => {
    await loginAndWaitForHome(page, 'passwordTarget');
    await page.goto('/profile');
    await page.getByTestId('profile-current-password').fill('Wrong!Password42');
    await page.getByTestId('profile-new-password').fill(NEW_PASSWORD);
    await page.getByTestId('profile-confirm-password').fill(NEW_PASSWORD);
    await page.getByTestId('profile-change-password').click();
    await page
      .getByTestId('profile-change-password-confirm')
      .getByTestId('alert-dialog-confirm')
      .click();

    await expect(
      getByTestIdAndValue(
        page.getByTestId('profile-password-form'),
        'field-error',
        'AUTH_PASSWORD_MISMATCH',
      ),
    ).toBeVisible();
    await expect(page.getByTestId('profile-page')).toBeVisible();
    await snapshot(page, 'current-password-mismatch');
    expect(await loginStatus(ACCOUNTS.passwordTarget, E2E_PASSWORD)).toBe(200);
  });

  test('從登入頁「忘記密碼」→ 收到重設信 → 設定新密碼 → 回到租戶登入並以新密碼登入', async ({
    page,
  }) => {
    await page.goto('/auth/login');
    await expectIdpLogin(page);
    await page.getByTestId('login-forgot-password-link').click();
    // 往前留 1 秒：容器與本機的時鐘可能有些微落差
    const requestedAt = new Date(Date.now() - 1000);
    await page.getByTestId('forgot-password-email').fill(ACCOUNTS.passwordTarget);
    await page.getByTestId('forgot-password-submit').click();
    await expect(page.getByTestId('forgot-password-sent')).toBeVisible();
    await snapshot(page, 'forgot-password-sent');

    const mail = await waitForMail(
      ACCOUNTS.passwordTarget,
      '重設你的 B2B System 密碼',
      requestedAt,
    );
    await page.goto(linkIn(mail, '/reset-password'));
    expect(page.url()).toContain('tenant=default');
    await page.getByTestId('reset-password-new').fill(NEW_PASSWORD);
    await page.getByTestId('reset-password-confirm').fill(NEW_PASSWORD);
    await page.getByTestId('reset-password-submit').click();

    await expectIdpLogin(page);
    await page.getByTestId('login-email').fill(ACCOUNTS.passwordTarget);
    await page.getByTestId('login-password').fill(NEW_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('home-page')).toBeVisible();
    await snapshot(page, 'signed-in-with-reset-password');

    // 用過的重設連結不能再用
    await page.goto(linkIn(mail, '/reset-password'));
    await page.getByTestId('reset-password-new').fill(E2E_PASSWORD);
    await page.getByTestId('reset-password-confirm').fill(E2E_PASSWORD);
    await page.getByTestId('reset-password-submit').click();
    await expect(page.getByTestId('reset-password-error')).toBeVisible();

    await restorePassword(NEW_PASSWORD);
  });

  test('忘記密碼不洩漏帳號是否存在：不存在的 email 一樣顯示「已寄出」', async ({ page }) => {
    await page.goto(`${PLATFORM_URL}/forgot-password?tenant=default`);
    await page.getByTestId('forgot-password-email').fill(`e2e-nobody-${Date.now()}@dev.local`);
    await page.getByTestId('forgot-password-submit').click();
    await expect(page.getByTestId('forgot-password-sent')).toBeVisible();
    await expect(page.getByTestId('forgot-password-error')).toHaveCount(0);
  });
});

test.describe('Refresh token 重放偵測（docs/architecture/backend/04-auth.md）', () => {
  test('重放已輪替掉的 refresh token → AUTH_REFRESH_REUSED，整條 family 撤銷並記入稽核', async () => {
    const context = await request.newContext();
    const login = await context.post(`${API_URL}/auth/login`, {
      data: { email: ACCOUNTS.member, password: E2E_PASSWORD },
    });
    expect(login.status()).toBe(200);

    const refreshCookie = async () =>
      (await context.storageState()).cookies.find((cookie) => cookie.name === 'refresh_token')!
        .value;
    const refresh = (cookie?: string) =>
      context.post(`${API_URL}/auth/refresh`, {
        headers: {
          'x-refresh-request': '1',
          ...(cookie ? { cookie: `refresh_token=${cookie}` } : {}),
        },
      });

    // A → B → C：同一條 family 輪替兩次（重送「上一個」在寬限期內算遺失的回應，要再往前一個才算重放）
    const first = await refreshCookie();
    expect((await refresh()).status()).toBe(200);
    expect((await refresh()).status()).toBe(200);
    const latest = await refreshCookie();

    const replayed = await refresh(first);
    expect(replayed.status()).toBe(401);
    expect(await replayed.json()).toMatchObject({ error: { code: 'AUTH_REFRESH_REUSED' } });

    // 連最新的 C 都失效
    const afterRevoke = await refresh(latest);
    expect(afterRevoke.status()).toBe(401);
    expect(await afterRevoke.json()).toMatchObject({ error: { code: 'AUTH_REFRESH_REVOKED' } });
    await context.dispose();

    const adminToken = await apiLogin('admin');
    const logs = await apiRequest(
      adminToken,
      'get',
      '/audit-logs?action=auth.refresh.reuse_detected&limit=5',
    );
    expect(logs.status).toBe(200);
    expect((logs.body as { data: { items: unknown[] } }).data.items.length).toBeGreaterThan(0);
  });
});
