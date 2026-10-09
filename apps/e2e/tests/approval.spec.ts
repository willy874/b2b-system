import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { PLATFORM_URL, expectIdpLogin, loginAndWaitForHome, loginPlatform } from '../helpers/auth';
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

/**
 * 單關與多階段的案例都送出註冊申請、讀寫同一份 `user.register` 的流程：放在同一個檔案依序執行。
 * 分成兩個檔案時，多階段的案例打開流程的那段時間，另一個檔案並行送出的申請會變成多關，找不到單關的審核對話框。
 */
test.describe.configure({ mode: 'default' });

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

/** apps/platform：預設租戶 → 功能 → 切換一個 feature（打開不需確認，關閉要確認）。 */
async function setTenantFeature(page: Page, feature: string, enabled: boolean): Promise<void> {
  await page.goto(`${PLATFORM_URL}/tenant`);
  await getByTestIdAndValue(page, 'tenant-link', 'default').click();
  await getByTestIdAndValue(page, 'tab', 'features').click();
  const toggle = getByTestIdAndValue(page, 'tenant-feature', feature).getByTestId(
    'tenant-feature-toggle',
  );
  if ((await toggle.getAttribute('aria-checked')) === String(enabled)) return;
  await toggle.click();
  if (!enabled) {
    await page.getByTestId('tenant-feature-dialog').getByTestId('alert-dialog-confirm').click();
  }
  await expect(toggle).toHaveAttribute('aria-checked', String(enabled));
}

async function userIdOf(token: string, email: string): Promise<string> {
  const users = (await apiRequest(token, 'get', `/users?keyword=${encodeURIComponent(email)}`))
    .body as { data: { items: Array<{ id: string; email: string }> } };
  return users.data.items.find((user) => user.email === email)!.id;
}

async function adminRoleIdOf(token: string): Promise<string> {
  const roles = (await apiRequest(token, 'get', '/roles?keyword=admin')).body as {
    data: { items: Array<{ id: string; slug: string }> };
  };
  return roles.data.items.find((role) => role.slug === 'admin')!.id;
}

/**
 * 多階段審批（docs/architecture/backend/20-approval.md §9）：確認平台已打開 `approvalChain`（預設開啟），admin 為註冊申請設定兩關的流程
 * （指定的 member → admin 角色），申請依序在兩個人的「我的審批」出現，最後一關核准後才建立帳號。
 */
test.describe('多階段審批（docs/architecture/backend/20-approval.md §9）', () => {
  test('註冊申請依序經過兩關：member 同意 → admin 同意後定案', async ({ browser, request }) => {
    const platformContext = await browser.newContext();
    const platform = await platformContext.newPage();
    await loginPlatform(platform);
    await setTenantFeature(platform, 'approvalChain', true);

    const adminToken = await apiLogin('admin');
    const users = (await apiRequest(adminToken, 'get', '/users?keyword=e2e-member@dev.local'))
      .body as { data: { items: Array<{ id: string; email: string }> } };
    const memberId = users.data.items.find((user) => user.email === 'e2e-member@dev.local')?.id;
    const roles = (await apiRequest(adminToken, 'get', '/roles?keyword=admin')).body as {
      data: { items: Array<{ id: string; slug: string }> };
    };
    const adminRoleId = roles.data.items.find((role) => role.slug === 'admin')?.id;
    expect(memberId && adminRoleId).toBeTruthy();

    // 流程可能是上一次執行留下的：先取版本再整份取代
    await expect
      .poll(
        async () => (await apiRequest(adminToken, 'get', '/approval-flows/user.register')).status,
      )
      .toBe(200);
    const current = (await apiRequest(adminToken, 'get', '/approval-flows/user.register')).body as {
      data: { flow: { version: number } | null };
    };
    const saved = await apiRequest(adminToken, 'put', '/approval-flows/user.register', {
      enabled: true,
      steps: [
        { name: '成員初審', assignee: { kind: 'user', id: memberId }, requiredApprovals: 1 },
        { name: '管理員', assignee: { kind: 'role', id: adminRoleId }, requiredApprovals: 1 },
      ],
      version: current.data.flow?.version,
    });
    expect(saved.status).toBe(200);
    const flowVersion = (saved.body as { data: { flow: { version: number } } }).data.flow.version;

    try {
      const email = `e2e-chain-${Date.now()}@dev.local`;
      const submitted = await request.post(`${API_URL}/auth/register`, {
        data: { email, displayName: 'E2E Chain' },
      });
      expect(submitted.status()).toBe(202);

      // ① member：「我的審批 → 待我審核」出現這一筆，同意
      const memberContext = await browser.newContext();
      const member = await memberContext.newPage();
      await loginAndWaitForHome(member, 'member');
      await member.goto('/my-approvals');
      await getByTestIdAndValue(member, 'my-approval-detail-link', email).click();
      const memberDialog = member.getByTestId('approval-detail-dialog');
      await expect(memberDialog.getByTestId('approval-timeline')).toBeVisible();
      await snapshot(member, 'chain-step-1');
      await member.getByTestId('approval-step-approve-button').click();
      await expect(memberDialog).toBeHidden();
      await memberContext.close();

      // ② admin：輪到「管理員」那一關；單關的快速審核不出現在多關請求上
      const adminContext = await browser.newContext();
      const admin = await adminContext.newPage();
      await loginAndWaitForHome(admin, 'admin');
      await admin.goto('/approval');
      await expect(getByTestIdAndValue(admin, 'approval-quick-approve', email)).toHaveCount(0);
      await admin.goto('/my-approvals');
      await getByTestIdAndValue(admin, 'my-approval-detail-link', email).click();
      await admin.getByTestId('approval-step-approve-button').click();
      await expect(admin.getByTestId('approval-detail-dialog')).toBeHidden();

      // ③ 定案：申請在「我的申請」之外的總表裡是已核准
      await admin.goto('/approval');
      await expect(
        admin
          .locator('tr', { has: getByTestIdAndValue(admin, 'approval-detail-link', email) })
          .getByTestId('approval-status'),
      ).toHaveAttribute('data-value', 'approved');
      await snapshot(admin, 'chain-approved');
      await adminContext.close();
    } finally {
      // 其他測試（註冊審批）與重跑的起點一致：停用流程；多階段審批維持預設的開啟
      await apiRequest(adminToken, 'put', '/approval-flows/user.register', {
        enabled: false,
        steps: [
          { name: '管理員', assignee: { kind: 'role', id: adminRoleId }, requiredApprovals: 1 },
        ],
        version: flowVersion,
      });
      await platformContext.close();
    }
  });
  test('在流程編輯頁加一關（指定使用者、帶條件）並移到最前面 → 試算看出條件不符的關卡被略過 → 儲存後列表更新', async ({
    page,
  }) => {
    const adminToken = await apiLogin('admin');
    const memberId = await userIdOf(adminToken, 'e2e-member@dev.local');
    const adminRoleId = await adminRoleIdOf(adminToken);
    const firstStep = `E2E 初審 ${Date.now()}`;
    const secondStep = `E2E 複審 ${Date.now()}`;

    // 起點：停用中、只有一關的流程（儲存為停用，不影響其他 spec 的註冊申請）
    const current = (await apiRequest(adminToken, 'get', '/approval-flows/user.register')).body as {
      data: { flow: { version: number } | null };
    };
    const reset = await apiRequest(adminToken, 'put', '/approval-flows/user.register', {
      enabled: false,
      steps: [
        { name: firstStep, assignee: { kind: 'role', id: adminRoleId }, requiredApprovals: 1 },
      ],
      version: current.data.flow?.version,
    });
    expect(reset.status).toBe(200);

    await loginAndWaitForHome(page, 'admin');
    await openMenuGroup(page, 'menu-group-system');
    await page.getByTestId('menu-setting').click();
    await getByTestIdAndValue(
      page.getByTestId('system-settings-tabs'),
      'tab',
      '/system/approval-flows',
    ).click();
    const card = getByTestIdAndValue(page, 'approval-flow-card', 'user.register');
    await expect(card.getByTestId('approval-flow-status')).toHaveAttribute(
      'data-value',
      'disabled',
    );
    await expect(card.getByTestId('approval-flow-step-summary')).toHaveText([firstStep]);
    await card.getByTestId('approval-flow-open').click();
    const editor = page.getByTestId('approval-flow-edit-page');
    await expect(getByTestIdAndValue(editor, 'approval-flow-step', '0')).toBeVisible();

    // ① 新增一關：指定 member，只有 email 網域是 e2e-flow.test 的申請才經過；移到最前面
    // （最後一關的候選人要有核准所需的權限，member 沒有，只能當前面的關卡，§9.6）
    await editor.getByTestId('approval-flow-step-add').click();
    const added = getByTestIdAndValue(editor, 'approval-flow-step', '1');
    await added.getByTestId('approval-flow-step-name').fill(secondStep);
    await added.getByTestId('approval-flow-assignee-user').click();
    await page.getByTestId('select-search').fill('e2e-member@dev.local');
    await getByTestIdAndValue(page, 'select-item', memberId).click();
    await added.getByTestId('approval-flow-condition-add').click();
    await added.getByTestId('approval-flow-condition-value').fill('e2e-flow.test');
    await added.getByTestId('approval-flow-step-up').click();
    await expect(
      getByTestIdAndValue(editor, 'approval-flow-step', '0').getByTestId('approval-flow-step-name'),
    ).toHaveValue(secondStep);

    // ② 試算：網域相符 → 第一關的候選人是 member；不符 → 第一關略過
    const preview = editor.getByTestId('approval-flow-preview');
    const domain = getByTestIdAndValue(preview, 'approval-flow-preview-field', 'emailDomain');
    await domain.fill('e2e-flow.test');
    await preview.getByTestId('approval-flow-preview-run').click();
    const previewFirst = getByTestIdAndValue(preview, 'approval-flow-preview-step', '0');
    await expect(previewFirst.getByTestId('approval-flow-preview-candidates')).toContainText(
      'E2E Member',
    );
    await expect(previewFirst.getByTestId('approval-flow-preview-skipped')).toHaveCount(0);
    await domain.fill('other.test');
    await preview.getByTestId('approval-flow-preview-run').click();
    await expect(previewFirst.getByTestId('approval-flow-preview-skipped')).toBeVisible();
    await snapshot(page, 'approval-flow-preview');

    // ③ 儲存 → 回到列表看到兩關（仍是停用）；伺服器上的條件與審核者照設定存下
    await editor.getByTestId('approval-flow-save').click();
    await expect(getByTestIdAndValue(page, 'toast', 'success')).toBeVisible();
    const saved = (await apiRequest(adminToken, 'get', '/approval-flows/user.register')).body as {
      data: {
        flow: {
          enabled: boolean;
          steps: Array<{
            name: string;
            assignee: { kind: string; id?: string };
            conditions?: Array<{ field: string; value: unknown }>;
          }>;
        };
      };
    };
    expect(saved.data.flow.enabled).toBe(false);
    expect(saved.data.flow.steps.map((step) => step.name)).toEqual([secondStep, firstStep]);
    expect(saved.data.flow.steps[0]!.assignee).toMatchObject({ kind: 'user', id: memberId });
    expect(saved.data.flow.steps[0]!.conditions?.[0]).toMatchObject({ field: 'emailDomain' });
    await editor.getByTestId('approval-flow-back').click();
    await expect(card.getByTestId('approval-flow-step-summary')).toHaveText([
      secondStep,
      firstStep,
    ]);
    await snapshot(page, 'approval-flow-saved');
  });

  test('auditor 看得到流程但不能編輯；member 沒有流程設定的分頁，直接進網址是 403 頁', async ({
    page,
    browser,
  }) => {
    await loginAndWaitForHome(page, 'auditor');
    await page.goto('/system/approval-flows/user.register');
    const editor = page.getByTestId('approval-flow-edit-page');
    await expect(editor).toBeVisible();
    await expect(editor.getByTestId('approval-flow-save')).toHaveCount(0);
    await expect(editor.getByTestId('approval-flow-step-add')).toHaveCount(0);
    await expect(editor.getByTestId('approval-flow-enabled')).toBeDisabled();
    await snapshot(page, 'approval-flow-read-only');

    const memberContext = await browser.newContext();
    const member = await memberContext.newPage();
    await loginAndWaitForHome(member, 'member');
    await expect(member.getByTestId('menu-setting')).toHaveCount(0);
    await member.goto('/system/approval-flows');
    await expect(member.getByTestId('forbidden-page')).toBeVisible();
    await memberContext.close();
  });
});
