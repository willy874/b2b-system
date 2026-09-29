import { expect, test } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { AUTH_URL, expectIdpLogin } from '../helpers/auth';
import { linkIn, waitForMail } from '../helpers/mailpit';

const NEW_PASSWORD = 'MailFlow!Password2026';

test.describe('郵件（docs/architecture/backend/11-mail.md）', () => {
  test('管理員建立帳號 → 從信箱點啟用連結設定密碼 → 可以登入', async ({ page }) => {
    const email = `e2e-invitee-${Date.now()}@dev.local`;

    // ① 管理員建立帳號（走 API，重點在後面的收信流程）
    const token = await apiLogin('admin');
    const created = await apiRequest(token, 'post', '/users', {
      email,
      displayName: 'E2E Invitee',
      roleIds: [],
    });
    expect(created.status).toBe(201);

    // ② 從 Mailpit 取出啟用信，打開連結
    const mail = await waitForMail(email);
    expect(mail.subject).toBe('啟用你的 B2B System 帳號');
    await page.goto(linkIn(mail, '/setup'));

    // ③ 設定密碼 → 回到登入頁 → 登入
    await page.getByTestId('setup-password').fill(NEW_PASSWORD);
    await page.getByTestId('setup-confirm').fill(NEW_PASSWORD);
    await page.getByTestId('setup-submit').click();
    await expectIdpLogin(page);

    // 啟用頁在 apps/auth：登入後進入 apps/auth 的首頁
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(NEW_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('home-display-name')).toHaveText('E2E Invitee');
  });

  test('用過的啟用連結再打開會顯示失效', async ({ page }) => {
    const email = `e2e-invitee-reuse-${Date.now()}@dev.local`;
    const token = await apiLogin('admin');
    await apiRequest(token, 'post', '/users', { email, displayName: 'E2E Reuse', roleIds: [] });

    const link = linkIn(await waitForMail(email), '/setup');
    await page.goto(link);
    await page.getByTestId('setup-password').fill(NEW_PASSWORD);
    await page.getByTestId('setup-confirm').fill(NEW_PASSWORD);
    await page.getByTestId('setup-submit').click();
    await expectIdpLogin(page);

    await page.goto(link);
    await expect(page.getByTestId('setup-invalid')).toBeVisible();
  });
});

test('已寄出的舊連結（backstage 的 /auth/setup）會轉到 apps/auth，token 一起帶過去', async ({
  page,
}) => {
  await page.goto('/auth/setup?token=legacy-token-123');
  await expect(page).toHaveURL(`${AUTH_URL}/setup?token=legacy-token-123`);
  await expect(page.getByTestId('setup-invalid')).toBeVisible();
});

test('工作區邀請新帳號：apps/auth 建立帳號 → 跳到 backstage 的工作區 → IdP 登入 → 進入工作區', async ({
  page,
}) => {
  const email = `e2e-invited-${Date.now()}@dev.local`;
  const token = await apiLogin('admin');
  const mine = await apiRequest(token, 'get', '/workspaces/mine');
  const workspaces = (mine.body as { data: { items: Array<{ id: string; slug: string }> } }).data
    .items;
  const workspace = workspaces.find((item) => item.slug === 'default');
  if (!workspace) throw new Error('e2e-admin 不是 default 工作區的成員');
  const roles = await apiRequest(token, 'get', `/workspaces/${workspace.id}/roles`);
  const member = (
    roles.body as { data: { items: Array<{ id: string; slug: string }> } }
  ).data.items.find((role) => role.slug === 'workspace-member');
  const invited = await apiRequest(token, 'post', `/workspaces/${workspace.id}/invitations`, {
    email,
    roleIds: member ? [member.id] : [],
  });
  expect(invited.status).toBe(201);

  await page.goto(linkIn(await waitForMail(email), '/invitation'));
  await expect(page).toHaveURL(new RegExp(`^${AUTH_URL}/invitation`));
  await page.getByTestId('invitation-display-name').fill('E2E Invited');
  await page.getByTestId('invitation-password').fill(NEW_PASSWORD);
  await page.getByTestId('invitation-confirm').fill(NEW_PASSWORD);
  await page.getByTestId('invitation-submit').click();

  // 跳到 backstage 的工作區 → 沒有 session → IdP 登入頁
  await expectIdpLogin(page);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(NEW_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/localhost:5173\/w\/default\//);
});
