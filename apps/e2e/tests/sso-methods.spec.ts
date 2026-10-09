import { expect, request, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD } from '../fixtures/accounts';
import { apiLogin, apiRequest } from '../helpers/api';
import {
  expectIdpLogin,
  loginAndWaitForHome,
  loginPlatform,
  logout,
  PLATFORM_URL,
} from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 更多的登入方式（docs/architecture/04-sso.md §3.3.2、§3.6）：
 * - SAML 2.0：在管理頁貼上 IdP 的 metadata 建立連線，經 `pnpm dev:mock-saml-idp`（127.0.0.1，與 apps/platform 不同站）登入。
 *   ACS 收到的是真正的跨站表單 POST，驗證 SameSite=None 的綁定 cookie 與之後的 303 在瀏覽器裡真的走得通。
 * - 通行金鑰：Chrome 的虛擬驗證器（CDP `WebAuthn`）；以「重新登入並新增」註冊，登出後不輸入密碼直接登入。
 */
const MOCK_SAML_IDP = process.env.E2E_MOCK_SAML_IDP_URL ?? 'http://127.0.0.1:4477';

test.describe('SAML 2.0 的外部 IdP', () => {
  test('貼上 IdP 的 metadata 建立連線 → 以 SAML 登入、自動建立帳號並回到 backstage', async ({
    page,
    browser,
  }) => {
    const suffix = Date.now().toString(36);
    const domain = `e2e-saml-${suffix}.test`;
    const name = `E2E SAML ${suffix}`;
    const context = await request.newContext();
    const metadata = await (await context.get(`${MOCK_SAML_IDP}/metadata`)).text();
    await context.dispose();

    await loginAndWaitForHome(page, 'superAdmin');
    await page.goto('/identity-provider');
    await expect(page.getByTestId('identity-provider-saml-acs-url')).toHaveValue(
      `${PLATFORM_URL}/api/oidc-interaction/external/saml/acs`,
    );
    await page.getByTestId('identity-provider-create-button').click();
    const dialog = page.getByTestId('identity-provider-form-dialog');
    await dialog.getByTestId('identity-provider-protocol-select').click();
    await page.getByRole('option', { name: 'SAML 2.0' }).click();
    await dialog.getByTestId('identity-provider-name-input').fill(name);
    await dialog
      .getByTestId('identity-provider-metadata-section')
      .getByRole('button')
      .first()
      .click();
    await dialog.getByTestId('identity-provider-metadata-input').fill(metadata);
    await dialog.getByTestId('identity-provider-metadata-apply').click();
    await expect(dialog.getByTestId('identity-provider-entity-id-input')).toHaveValue(
      `${MOCK_SAML_IDP}/metadata`,
    );
    await dialog.getByTestId('identity-provider-domain-add').click();
    await dialog.getByTestId('identity-provider-domain-input').fill(domain);
    await dialog.getByTestId('identity-provider-policy-select').click();
    await page.getByRole('option', { name: '自動建立帳號（沒有任何角色）' }).click();
    await snapshot(page, 'saml-provider-form');
    await dialog.getByTestId('identity-provider-form-submit').click();
    await expect(dialog).toBeHidden();
    await expect(getByTestIdAndValue(page, 'identity-provider-domain', domain)).toBeVisible();

    const login = await browser.newContext();
    const visitor = await login.newPage();
    try {
      await visitor.goto('/auth/login');
      await expectIdpLogin(visitor);
      await visitor.getByTestId('login-email').fill(`alice@${domain}`);
      await visitor.getByTestId('login-email').blur();
      await expect(visitor.getByTestId('login-external')).toContainText(name);
      await visitor.getByTestId('login-external').click();

      // 模擬的 SAML IdP（另一個站）→ 自動送出的表單 POST 到 ACS → complete → backstage
      await expect(visitor).toHaveURL(new RegExp(`^${MOCK_SAML_IDP}/sso`));
      await visitor.getByTestId('mock-saml-email').fill(`alice@${domain}`);
      await visitor.getByTestId('mock-saml-submit').click();
      await expect(visitor.getByTestId('home-page')).toBeVisible();
      await snapshot(visitor, 'saml-home');
    } finally {
      await login.close();
      await getByTestIdAndValue(page, 'identity-provider-remove', name).click();
      await page.getByTestId('alert-dialog-confirm').click();
      await expect(getByTestIdAndValue(page, 'identity-provider-domain', domain)).toHaveCount(0);
    }
  });
});

test.describe('通行金鑰取代密碼', () => {
  test.describe.configure({ mode: 'serial' });

  /** 平台管理者在 apps/platform 開啟 WebAuthn 與 `passkeyLogin`（或還原）。 */
  async function configureWebAuthn(platform: Page, passkeyLogin: 'enabled' | null): Promise<void> {
    await platform.goto(`${PLATFORM_URL}/mfa-method`);
    const row = getByTestIdAndValue(platform, 'mfa-method', 'webauthn');
    if (passkeyLogin) {
      await row.getByTestId('mfa-method-settings').click();
      const dialog = platform.getByTestId('mfa-method-settings-dialog');
      await dialog.getByTestId('mfa-setting-passkeyLogin').click();
      await platform.getByRole('option', { name: 'enabled' }).click();
      await dialog.getByTestId('mfa-method-settings-save').click();
      await expect(dialog).toBeHidden();
      await row.getByTestId('mfa-method-select').click();
      await platform.getByRole('option', { name: '全平台開啟' }).click();
      await expect(row.getByTestId('mfa-method-effective')).toHaveAttribute('data-value', 'true');
      return;
    }
    await row.getByTestId('mfa-method-select').click();
    await platform.getByRole('option', { name: '依預設' }).click();
  }

  async function virtualAuthenticator(page: Page): Promise<CDPSession> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    return cdp;
  }

  async function resetPasskeyMfa(): Promise<void> {
    const token = await apiLogin('superAdmin');
    const { body } = await apiRequest(
      token,
      'get',
      `/users?keyword=${encodeURIComponent(ACCOUNTS.passkey)}`,
    );
    const id = (body as { data: { items: Array<{ id: string; email: string }> } }).data.items.find(
      (user) => user.email === ACCOUNTS.passkey,
    )?.id;
    if (id) await apiRequest(token, 'post', `/users/${id}/mfa/reset`);
  }

  test('以「重新登入並新增」註冊通行金鑰 → 登出 → 不輸入密碼、以通行金鑰登入', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const platform = await browser.newPage({ baseURL: PLATFORM_URL, locale: 'zh-TW' });
    await loginPlatform(platform);
    await configureWebAuthn(platform, 'enabled');
    await virtualAuthenticator(page);
    try {
      await loginAndWaitForHome(page, 'passkey');
      await page.goto('/profile');
      await page.getByTestId('mfa-add').click();
      await getByTestIdAndValue(page, 'mfa-enroll-method', 'webauthn').click();

      // 跳到 apps/platform 重新驗證身分，之後設定（docs/architecture/backend/21-mfa.md §7.1）
      await expect(page.getByTestId('login-mfa-enroll-notice')).toBeVisible();
      await expect(page.getByTestId('login-passkey')).toHaveCount(0);
      await page.getByTestId('login-email').fill(ACCOUNTS.passkey);
      await page.getByTestId('login-password').fill(E2E_PASSWORD);
      await page.getByTestId('login-submit').click();
      await getByTestIdAndValue(page, 'mfa-enroll-method', 'webauthn').click();
      await page.getByTestId('mfa-webauthn-label').fill('E2E 虛擬金鑰');
      await page.getByTestId('mfa-webauthn-register').click();
      await page.getByTestId('mfa-recovery-saved').click();
      await page.getByTestId('mfa-recovery-done').click();
      await expect(page.getByTestId('mfa-status')).toHaveAttribute('data-value', 'true');
      await logout(page);

      await page.goto('/auth/login');
      await expectIdpLogin(page);
      await snapshot(page, 'passkey-login');
      await page.getByTestId('login-passkey').click();
      await expect(page.getByTestId('home-page')).toBeVisible();
    } finally {
      await resetPasskeyMfa();
      await configureWebAuthn(platform, null);
      await platform.close();
    }
  });
});
