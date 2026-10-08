import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { PLATFORM_URL, loginAndWaitForHome, loginPlatform } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

// 經過 backstage 的 /api 代理：api 以網域決定租戶（docs/architecture/05-tenancy.md §10.2 D2）
const API_URL =
  process.env.E2E_API_URL ?? `${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/api`;

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

/**
 * 多階段審批（docs/architecture/backend/20-approval.md §9）：平台打開 `approvalChain`，admin 為註冊申請設定兩關的流程
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
      // 其他測試（註冊審批）與重跑的起點一致：停用流程、關掉多階段審批
      await apiRequest(adminToken, 'put', '/approval-flows/user.register', {
        enabled: false,
        steps: [
          { name: '管理員', assignee: { kind: 'role', id: adminRoleId }, requiredApprovals: 1 },
        ],
        version: flowVersion,
      });
      await setTenantFeature(platform, 'approvalChain', false);
      await platformContext.close();
    }
  });
});
