import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD } from '../fixtures/accounts';
import type { AccountKey } from '../fixtures/accounts';
import { apiLogin, apiRequest } from '../helpers/api';
import {
  expectSignedOut,
  loginAndWaitForHome,
  loginPlatform,
  logout,
  PLATFORM_URL,
} from '../helpers/auth';
import { waitForMail } from '../helpers/mailpit';
import { getByTestIdAndValue } from '../helpers/selectors';
import { freshTotp } from '../helpers/totp';

/**
 * 多重驗證（docs/architecture/backend/21-mfa.md §14.5）：驗證器 App 的設定與登入、備用碼、Email 驗證碼（Mailpit）、
 * 政策要求後的首次設定、平台關掉方式之後的出路。驗證方式會被設定與重設，用專用帳號，依序執行並在結束時重設。
 */
test.describe.configure({ mode: 'serial' });

const CODE_SUBJECT = /^\d{6} 是你的驗證碼$/;

async function userIdOf(token: string, email: string): Promise<string> {
  const { body } = await apiRequest(token, 'get', `/users?keyword=${encodeURIComponent(email)}`);
  const id = (body as { data: { items: Array<{ id: string; email: string }> } }).data.items.find(
    (user) => user.email === email,
  )?.id;
  if (!id) throw new Error(`找不到 ${email}`);
  return id;
}

/** 以 super-admin 重設這個帳號的 MFA（案例結束時還原起點）。 */
async function resetMfa(account: AccountKey): Promise<void> {
  const token = await apiLogin('superAdmin');
  await apiRequest(token, 'post', `/users/${await userIdOf(token, ACCOUNTS[account])}/mfa/reset`);
}

/** 密碼步驟；需要 MFA 時停在第二步。 */
async function passwordStep(page: Page, account: AccountKey): Promise<void> {
  await page.goto('/auth/login');
  await page.getByTestId('login-email').fill(ACCOUNTS[account]);
  await page.getByTestId('login-password').fill(E2E_PASSWORD);
  await page.getByTestId('login-submit').click();
}

/** 收下備用碼：勾「我已保存」並關閉對話框，回傳畫面上的碼。 */
async function acceptRecoveryCodes(page: Page): Promise<string[]> {
  const dialog = page.getByTestId('mfa-recovery-dialog');
  await expect(dialog).toBeVisible();
  const codes = await dialog
    .getByTestId('mfa-recovery-code')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-value') ?? ''));
  expect(codes).toHaveLength(10);
  await page.getByTestId('mfa-recovery-saved').click();
  await page.getByTestId('mfa-recovery-done').click();
  return codes;
}

/** 在 /profile 設定驗證器 App；回傳 seed、用掉的時間步與備用碼。 */
async function enrollTotpOnProfile(page: Page) {
  await page.goto('/profile');
  await page.getByTestId('mfa-add').click();
  await getByTestIdAndValue(page, 'mfa-enroll-method', 'totp').click();
  await page.getByTestId('mfa-totp-show-secret').click();
  const secret = (await page.getByTestId('mfa-totp-secret').getAttribute('data-value')) ?? '';
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  const { code, counter } = await freshTotp(secret);
  await page.getByTestId('mfa-totp-code').fill(code);
  await page.getByTestId('mfa-totp-confirm').click();
  const recoveryCodes = await acceptRecoveryCodes(page);
  await expect(page.getByTestId('mfa-status')).toHaveAttribute('data-value', 'true');
  return { secret, counter, recoveryCodes };
}

test.describe('多重驗證', () => {
  test(
    '驗證器 App：在個人資料頁設定 → 登出 → 以驗證碼登入；再以備用碼登入一次',
    { tag: '@cross-browser' },
    async ({ page }) => {
      // 第二次用驗證碼要等下一個時間步（重放保護）
      test.setTimeout(120_000);
      try {
        await loginAndWaitForHome(page, 'mfaTotp');
        const { secret, counter, recoveryCodes } = await enrollTotpOnProfile(page);
        await logout(page);
        // 等登出的導向完成才開登入頁：否則 Firefox 以 NS_BINDING_ABORTED 中止下一個 goto
        await expectSignedOut(page);

        await passwordStep(page, 'mfaTotp');
        await expect(page.getByTestId('login-mfa')).toHaveAttribute('data-value', 'mfa');
        const next = await freshTotp(secret, counter);
        await page.getByTestId('mfa-code').fill(next.code);
        await page.getByTestId('mfa-submit').click();
        await expect(page.getByTestId('home-page')).toBeVisible();
        await logout(page);
        await expectSignedOut(page);

        await passwordStep(page, 'mfaTotp');
        await page.getByTestId('mfa-use-recovery').click();
        await page.getByTestId('mfa-recovery-input').fill(recoveryCodes[0]!);
        await page.getByTestId('mfa-recovery-submit').click();
        await expect(page.getByTestId('home-page')).toBeVisible();
        await page.goto('/profile');
        await expect(page.getByTestId('mfa-recovery-remaining')).toHaveAttribute('data-value', '9');
      } finally {
        await resetMfa('mfaTotp');
      }
    },
  );

  test('Email 驗證碼：設定時收信確認 → 登出 → 登入時寄出驗證碼（Mailpit）', async ({ page }) => {
    try {
      await loginAndWaitForHome(page, 'mfaEmail');
      await page.goto('/profile');
      const enrollSince = new Date();
      await page.getByTestId('mfa-add').click();
      await getByTestIdAndValue(page, 'mfa-enroll-method', 'email').click();
      const enrollMail = await waitForMail(ACCOUNTS.mfaEmail, CODE_SUBJECT, enrollSince);
      await page.getByTestId('mfa-email-code').fill(enrollMail.subject.slice(0, 6));
      await page.getByTestId('mfa-email-confirm').click();
      await acceptRecoveryCodes(page);
      await logout(page);
      await expectSignedOut(page);

      await passwordStep(page, 'mfaEmail');
      await expect(page.getByTestId('login-mfa')).toBeVisible();
      const loginSince = new Date();
      await page.getByTestId('mfa-email-send').click();
      const loginMail = await waitForMail(ACCOUNTS.mfaEmail, CODE_SUBJECT, loginSince);
      await page.getByTestId('mfa-code').fill(loginMail.subject.slice(0, 6));
      await page.getByTestId('mfa-submit').click();
      await expect(page.getByTestId('home-page')).toBeVisible();
    } finally {
      await resetMfa('mfaEmail');
    }
  });

  test('政策要求指定角色必須啟用 → 持有它的人登入時先設定，確認後拿到備用碼才進入', async ({
    page,
  }) => {
    const token = await apiLogin('superAdmin');
    const role = await apiRequest(token, 'post', '/roles', {
      name: `E2E MFA 必須 ${Date.now()}`,
      permissionKeys: [],
    });
    const roleId = (role.body as { data: { id: string } }).data.id;
    const userId = await userIdOf(token, ACCOUNTS.mfaPolicy);
    const before = await apiRequest(token, 'get', `/users/${userId}/roles`);
    const expectedRoleIds = (
      before.body as { data: { roles: Array<{ id: string }> } }
    ).data.roles.map((r) => r.id);
    await apiRequest(token, 'put', `/users/${userId}/roles`, {
      roleIds: [...expectedRoleIds, roleId],
      expectedRoleIds,
    });
    const policy = await apiRequest(token, 'get', '/mfa/policy');
    const version = (policy.body as { data: { version: number } }).data.version;
    const saved = await apiRequest(token, 'put', '/mfa/policy', {
      requireAll: false,
      requiredRoleIds: [roleId],
      allowedMethods: null,
      version,
    });
    expect(saved.status).toBe(200);
    try {
      await passwordStep(page, 'mfaPolicy');
      await expect(page.getByTestId('login-mfa')).toHaveAttribute('data-value', 'mfaEnroll');
      await getByTestIdAndValue(page, 'mfa-enroll-method', 'totp').click();
      await page.getByTestId('mfa-totp-show-secret').click();
      const secret = (await page.getByTestId('mfa-totp-secret').getAttribute('data-value')) ?? '';
      await page.getByTestId('mfa-totp-code').fill((await freshTotp(secret)).code);
      await page.getByTestId('mfa-totp-confirm').click();
      await acceptRecoveryCodes(page);
      await expect(page.getByTestId('home-page')).toBeVisible();
    } finally {
      const current = (await apiRequest(token, 'get', '/mfa/policy')).body as {
        data: { version: number };
      };
      await apiRequest(token, 'put', '/mfa/policy', {
        requireAll: false,
        requiredRoleIds: [],
        allowedMethods: null,
        version: current.data.version,
      });
      await resetMfa('mfaPolicy');
      await apiRequest(token, 'delete', `/roles/${roleId}?force=true`);
    }
  });

  test('平台全面關閉驗證器 App：只有它的人改用備用碼；平台開關頁看得到狀態', async ({
    page,
    browser,
  }) => {
    // 設定時可能要等下一個 TOTP 時間步，加上兩個 origin 的登入
    test.setTimeout(120_000);
    await loginAndWaitForHome(page, 'mfaTotp');
    const { recoveryCodes } = await enrollTotpOnProfile(page);
    await logout(page);
    await expectSignedOut(page);

    const platform = await browser.newPage({ baseURL: PLATFORM_URL, locale: 'zh-TW' });
    try {
      await loginPlatform(platform);
      await platform.goto(`${PLATFORM_URL}/mfa-method`);
      const row = getByTestIdAndValue(platform, 'mfa-method', 'totp');
      await row.getByTestId('mfa-method-select').click();
      await platform.getByRole('option', { name: '全平台關閉' }).click();
      await platform
        .getByTestId('mfa-method-off-dialog')
        .getByRole('button', { name: '關閉' })
        .click();
      await expect(row.getByTestId('mfa-method-effective')).toHaveAttribute('data-value', 'false');

      await passwordStep(page, 'mfaTotp');
      await expect(page.getByTestId('mfa-recovery-form')).toBeVisible();
      await page.getByTestId('mfa-recovery-input').fill(recoveryCodes[0]!);
      await page.getByTestId('mfa-recovery-submit').click();
      await expect(page.getByTestId('home-page')).toBeVisible();
    } finally {
      await restoreTotpDefault(platform);
      await platform.close();
      await resetMfa('mfaTotp');
    }
  });
});

/** 回到預設（全平台開關的起點）。 */
async function restoreTotpDefault(platform: Page): Promise<void> {
  await platform.goto(`${PLATFORM_URL}/mfa-method`);
  const row = getByTestIdAndValue(platform, 'mfa-method', 'totp');
  await row.getByTestId('mfa-method-select').click();
  await platform.getByRole('option', { name: '依預設' }).click();
  await expect(row.getByTestId('mfa-method-effective')).toHaveAttribute('data-value', 'true');
}
