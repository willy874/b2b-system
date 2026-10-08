import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

import { PLATFORM_URL, expectIdpLogin, loginPlatform } from '../helpers/auth';
import { linkIn, waitForMail } from '../helpers/mailpit';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 平台管理者（docs/architecture/05-tenancy.md §10.2 D5、apps/platform）：super-admin 新增一位 operator →
 * 對方從啟用信設定密碼 → 登入 apps/platform，看得到租戶、但不能新增平台管理者。帳號在平台 DB，與租戶的使用者無關。
 */

// 密碼政策會擋常見密碼的字根與 email／顯示名稱的片段（modules/credential）
const OPERATOR_PASSWORD = 'Zr8#mWq2!kTn5v';
const OPERATOR_NEW_PASSWORD = 'Hv4$tPx9!cRm2q';

/**
 * super-admin（`page`）新增一位 operator，對方從啟用信設定密碼並登入 apps/platform。
 * 回傳 operator 的分頁（另一個瀏覽器 context，用完要關）。
 */
async function createOperator(
  page: Page,
  browser: Browser,
  email: string,
  displayName: string,
): Promise<{ operator: Page; operatorContext: BrowserContext }> {
  await page.goto(`${PLATFORM_URL}/admin`);
  await page.getByTestId('platform-admin-create-button').click();
  const dialog = page.getByTestId('platform-admin-create-dialog');
  await dialog.getByTestId('platform-admin-email-input').fill(email);
  await dialog.getByTestId('platform-admin-display-name-input').fill(displayName);
  await dialog.getByTestId('platform-admin-role-select').click();
  await getByTestIdAndValue(page, 'select-item', 'operator').click();
  await dialog.getByTestId('platform-admin-create-submit').click();
  await expect(getByTestIdAndValue(page, 'platform-admin-email', email)).toBeVisible();

  const mail = await waitForMail(email);
  const operatorContext = await browser.newContext();
  const operator = await operatorContext.newPage();
  await operator.goto(linkIn(mail, '/setup'));
  await operator.getByTestId('setup-password').fill(OPERATOR_PASSWORD);
  await operator.getByTestId('setup-confirm').fill(OPERATOR_PASSWORD);
  await operator.getByTestId('setup-submit').click();
  await expectIdpLogin(operator);
  await operator.getByTestId('login-email').fill(email);
  await operator.getByTestId('login-password').fill(OPERATOR_PASSWORD);
  await operator.getByTestId('login-submit').click();
  await expect(operator.getByTestId('home-display-name')).toHaveText(displayName);
  return { operator, operatorContext };
}

test.describe('平台管理者（apps/platform）', () => {
  test('新增 operator → 從啟用信設定密碼 → 登入後看得到租戶，但沒有新增平台管理者的按鈕', async ({
    page,
    browser,
  }) => {
    const email = `e2e-operator-${Date.now()}@e2e.test`;

    await loginPlatform(page);
    await page.goto(`${PLATFORM_URL}/admin`);
    await page.getByTestId('platform-admin-create-button').click();
    const dialog = page.getByTestId('platform-admin-create-dialog');
    await dialog.getByTestId('platform-admin-email-input').fill(email);
    await dialog.getByTestId('platform-admin-display-name-input').fill('E2E Operator');
    await dialog.getByTestId('platform-admin-role-select').click();
    await getByTestIdAndValue(page, 'select-item', 'operator').click();
    await dialog.getByTestId('platform-admin-create-submit').click();
    const row = page.getByTestId('table-row').filter({
      has: getByTestIdAndValue(page, 'platform-admin-email', email),
    });
    await expect(getByTestIdAndValue(row, 'platform-admin-status', 'pending')).toBeVisible();
    await expect(getByTestIdAndValue(row, 'platform-admin-role', 'operator')).toBeVisible();
    await snapshot(page, 'operator-created');

    // 啟用信的連結不帶租戶：設定的是平台 DB 的帳號
    const mail = await waitForMail(email);
    const operatorContext = await browser.newContext();
    const operator = await operatorContext.newPage();
    await operator.goto(linkIn(mail, '/setup'));
    expect(operator.url()).not.toContain('tenant=');
    await operator.getByTestId('setup-password').fill(OPERATOR_PASSWORD);
    await operator.getByTestId('setup-confirm').fill(OPERATOR_PASSWORD);
    await operator.getByTestId('setup-submit').click();

    // 設定完密碼後回到 apps/platform 的登入
    await expectIdpLogin(operator);
    await operator.getByTestId('login-email').fill(email);
    await operator.getByTestId('login-password').fill(OPERATOR_PASSWORD);
    await operator.getByTestId('login-submit').click();
    await expect(operator.getByTestId('home-display-name')).toHaveText('E2E Operator');

    await operator.goto(`${PLATFORM_URL}/tenant`);
    await expect(getByTestIdAndValue(operator, 'tenant-link', 'default')).toBeVisible();
    await operator.goto(`${PLATFORM_URL}/admin`);
    await expect(operator.getByTestId('platform-admin-page')).toBeVisible();
    await expect(operator.getByTestId('platform-admin-create-button')).toHaveCount(0);
    await expect(operator.getByTestId('platform-admin-edit')).toHaveCount(0);
    await snapshot(operator, 'operator-read-only-admins');

    // operator 能改租戶但不能刪；平台的驗證方式開關只有 super-admin 能改
    await operator.goto(`${PLATFORM_URL}/tenant`);
    await getByTestIdAndValue(operator, 'tenant-link', 'default').click();
    await expect(operator.getByTestId('tenant-rename')).toBeVisible();
    await expect(operator.getByTestId('tenant-remove')).toHaveCount(0);
    await operator.goto(`${PLATFORM_URL}/mfa-method`);
    await expect(operator.getByTestId('mfa-method-page')).toBeVisible();
    for (const select of await operator.getByTestId('mfa-method-select').all()) {
      // oxlint-disable-next-line no-await-in-loop -- 逐一斷言，失敗訊息指出是哪一個
      await expect(select).toBeDisabled();
    }
    await snapshot(operator, 'operator-mfa-method-read-only');

    // 啟用後，super-admin 的列表顯示為啟用中
    await page.reload();
    await expect(getByTestIdAndValue(row, 'platform-admin-status', 'active')).toBeVisible();
    await operatorContext.close();
  });

  // 個人資料頁掛了未儲存提醒；改密碼成功結束 session 時不能被它擋下（web-core 的 SessionWatcher 帶 ignoreBlocker）
  test('operator 在個人資料頁改密碼 → 直接到「密碼已變更」的登入頁，不跳出未儲存提醒', async ({
    page,
    browser,
  }) => {
    await loginPlatform(page);
    const { operator, operatorContext } = await createOperator(
      page,
      browser,
      `e2e-operator-pw-${Date.now()}@e2e.test`,
      'E2E Password Operator',
    );

    await operator.goto(`${PLATFORM_URL}/profile`);
    await operator.getByTestId('profile-current-password').fill(OPERATOR_PASSWORD);
    await operator.getByTestId('profile-new-password').fill(OPERATOR_NEW_PASSWORD);
    await operator.getByTestId('profile-confirm-password').fill(OPERATOR_NEW_PASSWORD);
    await operator.getByTestId('profile-change-password').click();
    await operator
      .getByTestId('profile-change-password-confirm')
      .getByTestId('alert-dialog-confirm')
      .click();

    await expect(operator).toHaveURL(/\/login\?.*signedOut=true.*reason=password_changed/);
    await expect(operator.getByTestId('login-sso')).toBeVisible();
    await expect(operator.getByTestId('unsaved-changes-confirm')).toHaveCount(0);
    await snapshot(operator, 'signed-out-after-change');
    await operatorContext.close();
  });
});
