import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD } from '../fixtures/accounts';
import { PLATFORM_URL, expectIdpLogin, loginPlatform } from '../helpers/auth';
import { linkIn, waitForMail } from '../helpers/mailpit';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 兩個租戶（docs/architecture/05-tenancy.md §10）：平台管理者建立新租戶、第一位管理員從啟用信進入自己的後台；
 * 同一個 IdP session 換租戶要重新登入；授權碼換不到別的租戶；authorize 的租戶與 redirect URI 必須一致；
 * 停用後網域回 503。另一個租戶是種子資料的預設租戶（localhost:5173）。
 */
const CODE = `e2e-${Date.now().toString(36)}`;
/** 新租戶的預設網域：`{code}.<TENANT_BASE_DOMAIN>`；開發環境是 APP_PUBLIC_URL 的 host。 */
const TENANT_URL = `http://${CODE}.localhost:5173`;
const OWNER = `owner-${CODE}@e2e.test`;
/**
 * 不能含 email 的片段（`owner`、`e2e`）與租戶代碼：密碼政策會擋下（docs/architecture/backend/04-auth.md §4.2）。
 * 寫法同其他 spec 的隨機字串。
 */
const OWNER_PASSWORD = 'Hv6!qPz9#rWm2t';

test.describe.configure({ mode: 'serial' });

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/**
 * 從瀏覽器對某個網域的 api 發請求：`*.localhost` 只有瀏覽器會解析到本機（Node 的 request 解析不到）。
 * 先開那個網域的一個 api 網址，同源的 fetch 才不必處理 CORS。
 */
async function fetchOn(
  browser: Browser,
  origin: string,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<{ status: number; code?: string }> {
  const page = await newPage(browser);
  await page.goto(`${origin}/api/health`);
  const result = await page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, {
        method: init.method ?? 'GET',
        headers: init.body ? { 'content-type': 'application/json' } : undefined,
        body: init.body,
      });
      const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
      return { status: response.status, code: body.error?.code };
    },
    { path: `/api${path}`, init },
  );
  await page.context().close();
  return result;
}

test.describe('租戶實體隔離（兩個租戶）', () => {
  let platform: Page;
  let owner: Page;
  let tenantPath = '';

  test.beforeAll(async ({ browser }) => {
    platform = await newPage(browser);
    owner = await newPage(browser);
    await loginPlatform(platform);
  });

  test.afterAll(async () => {
    // 收掉這次建立的租戶（database 留給 db:drop-tenant；E2E 每次重置資料庫）
    if (tenantPath) {
      await platform.goto(`${PLATFORM_URL}${tenantPath}`);
      const remove = platform.getByTestId('tenant-remove');
      if (await remove.isVisible().catch(() => false)) {
        await remove.click();
        // 刪除租戶要輸入代碼才能確認
        await platform.getByTestId('tenant-remove-confirm-input').fill(CODE);
        await platform.getByTestId('tenant-remove-submit').click();
        await expect(platform.getByTestId('tenant-page')).toBeVisible();
      }
    }
    await platform.context().close();
    await owner.context().close();
  });

  test('平台管理者建立租戶 → 背景佈建 → 第一位管理員從啟用信設定密碼，登入自己網域的後台', async () => {
    await platform.goto(`${PLATFORM_URL}/tenant`);
    await platform.getByTestId('tenant-create-button').click();
    await platform.getByTestId('tenant-code-input').fill(CODE);
    await platform.getByTestId('tenant-name-input').fill(`E2E ${CODE}`);
    await platform.getByTestId('tenant-admin-email-input').fill(OWNER);
    await platform.getByTestId('tenant-create-submit').click();

    await expect(platform).toHaveURL(new RegExp(`^${PLATFORM_URL}/tenant/[0-9a-f-]{36}$`));
    tenantPath = new URL(platform.url()).pathname;
    await expect(platform.getByTestId('tenant-detail-page')).toBeVisible();
    await expect(getByTestIdAndValue(platform, 'tenant-status', 'active')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      getByTestIdAndValue(platform, 'tenant-domain', `${CODE}.localhost:5173`),
    ).toBeVisible();
    await snapshot(platform, 'tenant-provisioned');

    // 啟用信的連結在 apps/platform，帶上租戶代碼；設定完密碼回到這個租戶的登入
    const mail = await waitForMail(OWNER);
    const setup = linkIn(mail, '/setup');
    expect(setup).toContain(`tenant=${CODE}`);
    await owner.goto(setup);
    await owner.getByTestId('setup-password').fill(OWNER_PASSWORD);
    await owner.getByTestId('setup-confirm').fill(OWNER_PASSWORD);
    await owner.getByTestId('setup-submit').click();

    await expectIdpLogin(owner);
    await expect(owner.getByText(`E2E ${CODE}`, { exact: false })).toBeVisible();
    await owner.getByTestId('login-email').fill(OWNER);
    await owner.getByTestId('login-password').fill(OWNER_PASSWORD);
    await owner.getByTestId('login-submit').click();
    await expect(owner).toHaveURL(`${TENANT_URL}/`);
    await expect(owner.getByTestId('home-page')).toBeVisible();
    await snapshot(owner, 'owner-home');
  });

  test('同一個 IdP session 換到別的租戶 → 要求重新登入（不會以這個租戶的身分進去）', async () => {
    await owner.goto('http://localhost:5173/auth/login');
    await expectIdpLogin(owner);
    await expect(owner.getByText('預設租戶', { exact: false })).toBeVisible();
    // 新租戶的帳號在預設租戶不存在
    await owner.getByTestId('login-email').fill(OWNER);
    await owner.getByTestId('login-password').fill(OWNER_PASSWORD);
    await owner.getByTestId('login-submit').click();
    await expect(owner.getByTestId('login-error')).toBeVisible();
    await snapshot(owner, 'other-tenant-rejected');
  });

  test('預設租戶的授權碼送到新租戶的 BFF → AUTH_SSO_CODE_INVALID（D10）', async ({ browser }) => {
    const page = await newPage(browser);
    // 讓登入走到最後一步：攔下 backstage 送給自己 BFF 的授權碼（含 PKCE verifier），改送到另一個租戶
    let body: string | undefined;
    await page.route('http://localhost:5173/api/auth/sso/callback', async (route) => {
      body = route.request().postData() ?? undefined;
      await route.abort();
    });
    await page.goto('/auth/login');
    await expectIdpLogin(page);
    await page.getByTestId('login-email').fill(ACCOUNTS.superAdmin);
    await page.getByTestId('login-password').fill(E2E_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect.poll(() => body, { message: '等待 BFF 的請求' }).toBeTruthy();

    await page.context().close();
    expect(
      await fetchOn(browser, TENANT_URL, '/auth/sso/callback', { method: 'POST', body }),
    ).toEqual({ status: 400, code: 'AUTH_SSO_CODE_INVALID' });
  });

  test('authorize 帶新租戶、redirect URI 卻是預設租戶的網域 → invalid_request，不發授權碼（D7）', async ({
    browser,
  }) => {
    const page = await newPage(browser);
    const query = new URLSearchParams({
      client_id: 'backstage',
      tenant: CODE,
      redirect_uri: 'http://localhost:5173/auth/callback',
      response_type: 'code',
      scope: 'openid',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
    });
    await page.goto(`${PLATFORM_URL}/api/oidc/auth?${query.toString()}`);
    // redirect URI 本身是合法的（預設租戶的網域）：依 OAuth，錯誤帶回那裡，但沒有授權碼
    await expect(page).toHaveURL(
      /^http:\/\/localhost:5173\/auth\/callback\?.*error=invalid_request/,
    );
    expect(new URL(page.url()).searchParams.get('code')).toBeNull();
    await page.context().close();
  });

  test('停用租戶 → 它的網域回 503，已登入的後台失效；預設租戶不受影響', async ({ browser }) => {
    await platform.goto(`${PLATFORM_URL}${tenantPath}`);
    await platform.getByTestId('tenant-disable').click();
    await platform.getByTestId('alert-dialog-confirm').click();
    await expect(getByTestIdAndValue(platform, 'tenant-status', 'disabled')).toBeVisible();
    await snapshot(platform, 'tenant-disabled');

    expect(await fetchOn(browser, TENANT_URL, '/tenant/current')).toEqual({
      status: 503,
      code: 'TENANT_UNAVAILABLE',
    });
    // 已登入的分頁：session 已撤銷，重新整理後回不到首頁
    await owner.goto(`${TENANT_URL}/`);
    await expect(owner.getByTestId('home-page')).toHaveCount(0);
    expect((await fetchOn(browser, 'http://localhost:5173', '/tenant/current')).status).toBe(200);
  });
});
