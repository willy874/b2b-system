import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ACCOUNTS } from '../fixtures/accounts';
import { apiLogin, apiRequest } from '../helpers/api';
import { loginAndWaitForHome } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

// 密碼政策會擋常見密碼的字根與 email／顯示名稱的片段（modules/credential）
const APPLICANT_PASSWORD = 'Wm3#pLq8!zRt6v';
// 經過 backstage 的 /api 代理：api 以網域決定租戶（docs/architecture/05-tenancy.md §10.2 D2）
const API_URL =
  process.env.E2E_API_URL ?? `${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/api`;

interface NotificationDto {
  id: string;
  type: string;
  params: Record<string, unknown>;
  link: { route: string; params: Record<string, string> } | null;
  readAt: string | null;
}

interface UserWithRoles {
  id: string;
  roles: Array<{ id: string }>;
}

async function listNotifications(token: string): Promise<NotificationDto[]> {
  const response = await apiRequest(token, 'get', '/notifications?limit=100');
  expect(response.status).toBe(200);
  return (response.body as { data: { items: NotificationDto[] } }).data.items;
}

async function unreadCount(token: string): Promise<number> {
  const response = await apiRequest(token, 'get', '/notifications/unread-count');
  return (response.body as { data: { count: number } }).data.count;
}

/** 頂列鈴鐺的徽章數字；沒有徽章（沒有未讀）是 0。 */
async function badgeCount(page: Page): Promise<number> {
  const badge = page.getByTestId('notification-unread-count');
  if ((await badge.count()) === 0) return 0;
  return Number(await badge.getAttribute('data-value'));
}

/** 替通知專用的帳號切換 auditor 角色（有就移除、沒有就加上）：每次都會有實際增減，所以一定會發通知。 */
async function toggleAuditorRole(adminToken: string): Promise<void> {
  const users = (await apiRequest(adminToken, 'get', `/users?keyword=${ACCOUNTS.notifyTarget}`))
    .body as { data: { items: UserWithRoles[] } };
  const target = users.data.items[0]!;
  const roles = (await apiRequest(adminToken, 'get', '/roles?limit=100')).body as {
    data: { items: Array<{ id: string; slug: string }> };
  };
  const auditor = roles.data.items.find((role) => role.slug === 'auditor')!;
  const current = target.roles.map((role) => role.id);
  const next = current.includes(auditor.id)
    ? current.filter((id) => id !== auditor.id)
    : [...current, auditor.id];
  const response = await apiRequest(adminToken, 'put', `/users/${target.id}/roles`, {
    roleIds: next,
    expectedRoleIds: current,
  });
  expect(response.status).toBe(200);
}

test.describe('站內通知（docs/architecture/frontend/15-notification.md、docs/architecture/backend/15-notification.md §12）', () => {
  test('有人送出註冊申請 → 審核者的鈴鐺出現未讀，點開後到審批詳情並標為已讀', async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const email = `e2e-notify-applicant-${stamp}@dev.local`;
    const displayName = `E2E Notify ${stamp}`;

    // 審核者先登入：新通知經推播出現，不必重新整理
    await loginAndWaitForHome(page, 'admin');
    await expect(page.getByTestId('notification-bell')).toBeVisible();

    // ① 匿名送出註冊申請（approval.pending 給所有持有 approval:review 的人）
    const registered = await request.post(`${API_URL}/auth/register`, {
      data: { email, displayName, password: APPLICANT_PASSWORD, reason: 'E2E 通知' },
    });
    expect(registered.status()).toBe(202);

    const adminToken = await apiLogin('admin');
    let pending: NotificationDto | undefined;
    await expect
      .poll(async () => {
        pending = (await listNotifications(adminToken)).find(
          (item) => item.type === 'approval.pending' && item.params.subject === displayName,
        );
        return pending;
      })
      .toBeDefined();
    const notification = pending!;
    expect(notification.link?.route).toBe('approval.detail');
    const approvalId = notification.link!.params.approvalId!;

    // ② 徽章跟著推播更新（其他並行的測試也可能送出申請，所以與伺服器的未讀數比對，而不是寫死數字）
    await expect(page.getByTestId('notification-unread-count')).toBeVisible();
    await expect
      .poll(async () => (await badgeCount(page)) === (await unreadCount(adminToken)))
      .toBe(true);

    // ③ 打開鈴鐺，點這一則 → 審批詳情（審核對話框疊在列表上）
    await page.getByTestId('notification-bell').click();
    const panel = page.getByTestId('notification-panel');
    const item = getByTestIdAndValue(panel, 'notification-item', notification.id);
    await expect(item).toHaveAttribute('data-state', 'unread');
    await expect(item).toContainText(email);
    await expect(item).toContainText(displayName);
    await snapshot(page, 'bell-open');

    await item.click();
    await expect(page).toHaveURL(new RegExp(`/approval/${approvalId}$`));
    await expect(page.getByTestId('approval-detail-dialog')).toContainText(email);
    await expect(panel).toBeHidden();

    // ④ 這一則在伺服器上變成已讀，徽章跟著伺服器的未讀數更新。
    // 精確的「少一」由下一個案例的專用帳號斷言：admin 可能同時收到其他並行測試的申請
    await expect
      .poll(async () =>
        (await listNotifications(adminToken)).find((entry) => entry.id === notification.id),
      )
      .toMatchObject({ readAt: expect.any(String) });
    await expect
      .poll(async () => (await badgeCount(page)) === (await unreadCount(adminToken)))
      .toBe(true);
    await snapshot(page, 'approval-detail-from-notification');
  });

  test('角色被指派或移除 → 本人收到 user.rolesChanged；點開到個人資料頁、全部已讀', async ({
    page,
  }) => {
    // 專用帳號：只有這個測試會改它的角色，未讀數可以精確斷言。從沒有未讀開始
    const targetToken = await apiLogin('notifyTarget');
    await apiRequest(targetToken, 'post', '/notifications/read-all');
    const adminToken = await apiLogin('admin');

    await loginAndWaitForHome(page, 'notifyTarget');
    await expect(page.getByTestId('notification-bell')).toBeVisible();
    await expect(page.getByTestId('notification-unread-count')).toHaveCount(0);

    // ① admin 改了他的角色 → 推播讓徽章出現 1（不重新整理）
    await toggleAuditorRole(adminToken);
    await expect(page.getByTestId('notification-unread-count')).toHaveAttribute('data-value', '1');

    // ② 點開這一則 → 個人資料頁，徽章消失
    await page.getByTestId('notification-bell').click();
    const panel = page.getByTestId('notification-panel');
    const first = panel.getByTestId('notification-item').first();
    await expect(first).toHaveAttribute('data-state', 'unread');
    await expect(first).toContainText('稽核人員');
    await snapshot(page, 'roles-changed');
    await first.click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByTestId('notification-unread-count')).toHaveCount(0);

    // ③ 再改兩次 → 兩則未讀；在列表頁按「全部已讀」
    await toggleAuditorRole(adminToken);
    await toggleAuditorRole(adminToken);
    await expect(page.getByTestId('notification-unread-count')).toHaveAttribute('data-value', '2');

    await page.getByTestId('notification-bell').click();
    await expect(panel.getByTestId('notification-item').first()).toHaveAttribute(
      'data-state',
      'unread',
    );
    await panel.getByTestId('notification-mark-all-read').click();
    await expect(page.getByTestId('notification-unread-count')).toHaveCount(0);
    await expect(
      panel.locator('[data-testid="notification-item"][data-state="unread"]'),
    ).toHaveCount(0);
    await snapshot(page, 'all-read');

    // ④ 完整列表頁：「全部」列出剛才的三則（都已讀；重試時前面還有上一輪的），「未讀」分頁是空的
    await panel.getByTestId('notification-view-all').click();
    await expect(page.getByTestId('notification-list-page')).toBeVisible();
    const all = page.getByTestId('notification-page-list').getByTestId('notification-item');
    await expect(all.nth(2)).toHaveAttribute('data-state', 'read');
    await expect(all.first()).toContainText('稽核人員');
    await page.getByRole('tab', { name: '未讀' }).click();
    await expect(page).toHaveURL(/filter=unread/);
    await expect(page.getByTestId('notification-empty')).toBeVisible();
    await snapshot(page, 'list-page-unread-empty');
  });
});
