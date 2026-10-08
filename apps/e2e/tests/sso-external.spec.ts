import { expect, test } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { PLATFORM_URL, expectIdpLogin, login } from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 外部 IdP 登入（docs/architecture/04-sso.md §12.2 D8–D10）。外部 IdP 是 `pnpm dev:mock-idp`
 * （playwright.config.ts 會啟動）：登入頁輸入任何 email 都算登入成功。
 */
const MOCK_IDP = {
  name: 'E2E 模擬 IdP',
  issuer: process.env.E2E_MOCK_IDP_URL ?? 'http://localhost:4455',
  clientId: 'b2b-mock',
  clientSecret: 'mock-secret',
};
const SSO_DOMAIN = 'e2e-sso.test';

test.describe('外部 IdP 登入', () => {
  test.beforeAll(async () => {
    const token = await apiLogin('superAdmin');
    const created = await apiRequest(token, 'post', '/identity-providers', {
      ...MOCK_IDP,
      unmatchedPolicy: 'auto_create',
      domains: [{ domain: SSO_DOMAIN, ssoOnly: true }],
    });
    // E2E_SKIP_SEED=1 重跑時連線已經存在
    expect([201, 409]).toContain(created.status);
  });

  test('只允許 SSO 的網域：不顯示密碼欄，經外部 IdP 登入後自動建立帳號並回到 backstage', async ({
    page,
  }) => {
    const email = `sso-${Date.now()}@${SSO_DOMAIN}`;
    await page.goto('/auth/login');
    await expectIdpLogin(page);

    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-email').blur();
    await expect(page.getByTestId('login-sso-only')).toBeVisible();
    await expect(page.getByTestId('login-password')).toHaveCount(0);
    await snapshot(page, 'sso-only-login');
    await page.getByTestId('login-external').click();

    // 模擬 IdP 的登入與同意頁（oidc-provider devInteractions）
    await expect(page).toHaveURL(new RegExp(`^${MOCK_IDP.issuer}/`));
    await snapshot(page, 'external-idp');
    await page.locator('input[name="login"]').fill(email);
    await page.locator('input[name="password"]').fill('anything');
    await page.locator('button[type="submit"]').click();
    await page.locator('button[type="submit"]').click();

    // 外部 IdP → api 的固定 callback → 完成互動 → backstage 的 callback → 首頁
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page).toHaveURL(/localhost:5173\//);
    await snapshot(page, 'sso-home');
  });

  test('只允許 SSO 的網域：在 email 欄按 Enter 就走外部 IdP（沒有密碼登入可選）', async ({
    page,
  }) => {
    await page.goto('/auth/login');
    await expectIdpLogin(page);
    await page.getByTestId('login-email').fill(`someone@${SSO_DOMAIN}`);
    await page.getByTestId('login-email').blur();
    await expect(page.getByTestId('login-sso-only')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toHaveCount(0);
    await page.getByTestId('login-email').press('Enter');
    await expect(page).toHaveURL(new RegExp(`^${MOCK_IDP.issuer}/`));
  });

  test('管理頁列出連線與要登記在外部 IdP 的 redirect URI', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByTestId('home-page')).toBeVisible();
    await openMenuGroup(page, 'menu-group-system');
    await page.getByTestId('menu-identity-provider').click();
    await expect(page.getByTestId('identity-provider-page')).toBeVisible();
    await expect(getByTestIdAndValue(page, 'identity-provider-domain', SSO_DOMAIN)).toBeVisible();
    await expect(page.getByTestId('identity-provider-callback-url')).toHaveValue(
      `${PLATFORM_URL}/api/oidc-interaction/external/callback`,
    );
    await snapshot(page, 'identity-provider-page');
  });
  test('super-admin 在管理頁新增連線 → 登入頁對那個網域多出外部 IdP 登入；改名後顯示新名稱；刪除後消失', async ({
    page,
    browser,
  }) => {
    const suffix = Date.now().toString(36);
    const domain = `e2e-idp-${suffix}.test`;
    const name = `E2E 新連線 ${suffix}`;
    const renamed = `E2E 改名連線 ${suffix}`;

    // 登入頁（未登入的另一個 context）：email 欄離開後依網域找連線
    const probeExternal = async () => {
      const context = await browser.newContext();
      const probe = await context.newPage();
      await probe.goto('/auth/login');
      await expectIdpLogin(probe);
      await probe.getByTestId('login-email').fill(`someone@${domain}`);
      await probe.getByTestId('login-email').blur();
      return { probe, context };
    };

    await login(page, 'superAdmin');
    await expect(page.getByTestId('home-page')).toBeVisible();
    await page.goto('/identity-provider');

    // ① 新增（不限 SSO：密碼登入照舊可用）
    await page.getByTestId('identity-provider-create-button').click();
    const dialog = page.getByTestId('identity-provider-form-dialog');
    await dialog.getByTestId('identity-provider-name-input').fill(name);
    await dialog.getByTestId('identity-provider-issuer-input').fill(MOCK_IDP.issuer);
    await dialog.getByTestId('identity-provider-client-id-input').fill(MOCK_IDP.clientId);
    await dialog.getByTestId('identity-provider-client-secret-input').fill(MOCK_IDP.clientSecret);
    await dialog.getByTestId('identity-provider-domain-add').click();
    await dialog.getByTestId('identity-provider-domain-input').fill(domain);
    await dialog.getByTestId('identity-provider-form-submit').click();
    await expect(dialog).toBeHidden();
    await expect(getByTestIdAndValue(page, 'identity-provider-domain', domain)).toBeVisible();
    await snapshot(page, 'identity-provider-created');

    try {
      const first = await probeExternal();
      await expect(first.probe.getByTestId('login-external')).toContainText(name);
      await expect(first.probe.getByTestId('login-password')).toBeVisible();
      await first.context.close();

      // ② 改名（密鑰留空＝沿用）
      await getByTestIdAndValue(page, 'identity-provider-edit', name).click();
      await dialog.getByTestId('identity-provider-name-input').fill(renamed);
      await dialog.getByTestId('identity-provider-form-submit').click();
      await expect(dialog).toBeHidden();
      await expect(getByTestIdAndValue(page, 'identity-provider-edit', renamed)).toBeVisible();
      const second = await probeExternal();
      await expect(second.probe.getByTestId('login-external')).toContainText(renamed);
      await second.context.close();
    } finally {
      // ③ 刪除 → 登入頁對那個網域沒有外部 IdP
      const current = (await getByTestIdAndValue(page, 'identity-provider-remove', renamed).count())
        ? renamed
        : name;
      await getByTestIdAndValue(page, 'identity-provider-remove', current).click();
      await page.getByTestId('alert-dialog-confirm').click();
      await expect(getByTestIdAndValue(page, 'identity-provider-domain', domain)).toHaveCount(0);
    }
    const third = await probeExternal();
    await expect(third.probe.getByTestId('login-password')).toBeVisible();
    await expect(third.probe.getByTestId('login-external')).toHaveCount(0);
    await third.context.close();
  });
});
