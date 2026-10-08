import { expect, test } from '@playwright/test';

import { expectIdpLogin, loginAndWaitForHome } from '../helpers/auth';
import { linkIn, waitForMail } from '../helpers/mailpit';
import { openMenuGroup } from '../helpers/menu';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

// 申請時不設密碼：啟用前用任何密碼都登入不了（docs/architecture/backend/20-approval.md §5.1）
const GUESSED_PASSWORD = 'Tq7!vRx#2mLp9w';
// 密碼政策會擋常見密碼的字根（password）與 email／顯示名稱的片段（modules/credential）
const ACTIVATED_PASSWORD = 'Kd4$wNz8!qHs3v';
const ACTIVATION_MAIL_SUBJECT = '啟用你的 B2B System 帳號';
// 經過 backstage 的 /api 代理：api 以網域決定租戶（docs/architecture/05-tenancy.md §10.2 D2）
const API_URL =
  process.env.E2E_API_URL ?? `${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/api`;

test.describe('註冊審批（docs/architecture/backend/20-approval.md）', () => {
  test('申請帳號 → admin 核准並指派角色 → 申請人從啟用信設定密碼後可以登入', async ({
    page,
    browser,
  }) => {
    const email = `e2e-applicant-${Date.now()}@dev.local`;

    // ① 未登入：從 IdP 的登入頁（apps/platform）進入申請頁並送出
    await page.goto('/auth/login');
    await page.getByTestId('login-register-link').click();
    await page.getByTestId('register-email').fill(email);
    await page.getByTestId('register-display-name').fill('E2E Applicant');
    await page.getByTestId('register-reason').fill('E2E 測試');
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-submitted')).toBeVisible();
    await snapshot(page, 'register-submitted');

    // 核准前不能登入
    await page.goto('/auth/login');
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(GUESSED_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toBeVisible();

    // ② admin 在審批頁核准並指派 member
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAndWaitForHome(adminPage, 'admin');
    await openMenuGroup(adminPage, 'menu-group-people');
    await adminPage.getByTestId('menu-approval').click();
    await expect(adminPage.getByTestId('approval-list-page')).toBeVisible();
    await getByTestIdAndValue(adminPage, 'approval-detail-link', email).click();

    const dialog = adminPage.getByTestId('approval-detail-dialog');
    await expect(dialog).toContainText(email);
    await adminPage.getByTestId('approval-role-select').click();
    // 選項的 data-value 是角色 id（每次 seed 不同），以 slug 說明文字定位
    await adminPage
      .getByTestId('select-item')
      .filter({ hasText: /^一般成員member$/ })
      .click();
    await adminPage.keyboard.press('Escape');
    await expect(adminPage.getByTestId('approval-role-select')).toContainText('一般成員');
    await adminPage.getByTestId('approval-comment-input').fill('歡迎加入');
    await snapshot(adminPage, 'approval-dialog');
    await adminPage.getByTestId('approval-approve-button').click();
    await expect(dialog).toBeHidden();
    await expect(
      adminPage
        .locator('tr', { has: getByTestIdAndValue(adminPage, 'approval-detail-link', email) })
        .getByTestId('approval-status'),
    ).toHaveAttribute('data-value', 'approved');
    await snapshot(adminPage, 'approved');
    await adminContext.close();

    // ③ 核准後帳號是 pending、沒有密碼：啟用前登入被擋下
    await page.goto('/auth/login');
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(GUESSED_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await snapshot(page, 'login-before-activation');

    // ④ 從信箱打開啟用信的連結設定密碼（同時會收到審核結果信，以主旨挑出啟用信）
    const mail = await waitForMail(email, ACTIVATION_MAIL_SUBJECT);
    await page.goto(linkIn(mail, '/setup'));
    await page.getByTestId('setup-password').fill(ACTIVATED_PASSWORD);
    await page.getByTestId('setup-confirm').fill(ACTIVATED_PASSWORD);
    await page.getByTestId('setup-submit').click();
    await expectIdpLogin(page);

    // ⑤ 以啟用時設定的密碼登入
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(ACTIVATED_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('home-page')).toBeVisible();
    await snapshot(page, 'applicant-home');
  });

  test('列上快速核准與快速駁回（不開對話框）', async ({ page, request }) => {
    const approveEmail = `e2e-quick-ok-${Date.now()}@dev.local`;
    const rejectEmail = `e2e-quick-no-${Date.now()}@dev.local`;
    const responses = await Promise.all(
      [approveEmail, rejectEmail].map((email) =>
        request.post(`${API_URL}/auth/register`, {
          data: { email, displayName: 'E2E Quick' },
        }),
      ),
    );
    for (const response of responses) expect(response.status()).toBe(202);

    await loginAndWaitForHome(page, 'admin');
    await page.goto('/approval');
    const statusOf = (email: string) =>
      page
        .locator('tr', { has: getByTestIdAndValue(page, 'approval-detail-link', email) })
        .getByTestId('approval-status');

    await getByTestIdAndValue(page, 'approval-quick-approve', approveEmail).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '核准' }).click();
    await expect(statusOf(approveEmail)).toHaveAttribute('data-value', 'approved');

    await getByTestIdAndValue(page, 'approval-quick-reject', rejectEmail).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '駁回' }).click();
    await expect(statusOf(rejectEmail)).toHaveAttribute('data-value', 'rejected');

    // 已審核的列不再有快速審核
    await expect(getByTestIdAndValue(page, 'approval-quick-approve', approveEmail)).toHaveCount(0);
    await snapshot(page, 'quick-reviewed');
  });

  test('auditor 看得到審批列表，但沒有審核操作', async ({ page }) => {
    await loginAndWaitForHome(page, 'auditor');
    await openMenuGroup(page, 'menu-group-people');
    await page.getByTestId('menu-approval').click();
    await expect(page.getByTestId('approval-list-page')).toBeVisible();

    const link = page.getByTestId('approval-detail-link').first();
    if ((await link.count()) === 0) return; // 沒有任何申請時不需驗證對話框
    await link.click();
    await expect(page.getByTestId('approval-detail-dialog')).toBeVisible();
    await expect(page.getByTestId('approval-review-form')).toHaveCount(0);
  });

  test('auditor 的列表沒有快速審核按鈕', async ({ page }) => {
    await loginAndWaitForHome(page, 'auditor');
    await page.goto('/approval');
    await expect(page.getByTestId('approval-table')).toBeVisible();
    await expect(page.getByTestId('approval-quick-approve')).toHaveCount(0);
  });

  test('member 看不到審批選單，直接進網址是 403 頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await expect(page.getByTestId('menu-approval')).toHaveCount(0);
    await page.goto('/approval');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
  });
});
