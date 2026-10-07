import { expect, test } from '@playwright/test';

import { ACCOUNTS } from '../fixtures/accounts';
import { apiLogin, apiRequest } from '../helpers/api';
import { loginAndWaitForHome } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 公告（docs/architecture/backend/19-announcement.md）：草稿 → 發布（立即）→ 背景工作展開給收件人 →
 * 收件人的鈴鐺出現 `announcement.published`，點開看到內文。收件人用專用帳號 `announceTarget`。
 * 個人關掉這類通知的案例會改 `announceTarget` 的偏好與租戶的事件設定，所以整個檔案依序執行。
 */

const ANNOUNCEMENT_TYPE = 'announcement.published';

const unique = (prefix: string) => `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function userIdOf(token: string, email: string): Promise<string> {
  const response = await apiRequest(token, 'get', `/users?keyword=${encodeURIComponent(email)}`);
  expect(response.status).toBe(200);
  return (response.body as { data: { items: Array<{ id: string }> } }).data.items[0]!.id;
}

test.describe('公告（docs/architecture/backend/19-announcement.md）', () => {
  test.describe.configure({ mode: 'serial' });

  test('建立公告並立即發布 → 收件人的鈴鐺收到通知，點開看到標題與內文', async ({
    page,
    browser,
  }) => {
    const token = await apiLogin('admin');
    const targetId = await userIdOf(token, ACCOUNTS.announceTarget);
    const title = unique('E2E 公告');
    const body = '系統將於今晚維護，請提前存檔。';

    // 收件人先登入：通知經推播出現在鈴鐺，不必重新整理
    const recipientContext = await browser.newContext();
    const recipient = await recipientContext.newPage();
    await loginAndWaitForHome(recipient, 'announceTarget');

    // ① 建立草稿：指定收件人、觸發方式預設是「立即」
    await loginAndWaitForHome(page, 'admin');
    await page.goto('/announcement');
    await page.getByTestId('announcement-create-button').click();
    await page.getByTestId('announcement-title-input').fill(title);
    await page.getByTestId('announcement-body-input').fill(body);
    await page.getByTestId('announcement-audience-users').click();
    await page.getByTestId('select-search').fill(ACCOUNTS.announceTarget);
    await getByTestIdAndValue(page, 'select-item', targetId).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('announcement-audience-count')).toContainText('1');
    await page.getByTestId('announcement-create-submit').click();

    const detail = page.getByTestId('announcement-detail-dialog');
    await expect(getByTestIdAndValue(detail, 'announcement-detail-status', 'draft')).toBeVisible();

    // ② 發布 → 展開工作送出
    await detail.getByTestId('announcement-publish').click();
    await page
      .getByTestId('announcement-publish-confirm')
      .getByTestId('alert-dialog-confirm')
      .click();
    await expect(
      getByTestIdAndValue(detail, 'announcement-dispatch-status', 'sent').first(),
    ).toBeVisible({ timeout: 20_000 });
    await snapshot(page, 'announcement-sent');

    // ③ 收件人：鈴鐺的未讀 → 通知的快速連結 → 公告頁
    await expect(recipient.getByTestId('notification-unread-count')).toBeVisible();
    await recipient.getByTestId('notification-bell').click();
    const item = recipient
      .getByTestId('notification-panel')
      .getByTestId('notification-item')
      .filter({ hasText: title });
    await expect(item).toHaveAttribute('data-state', 'unread');
    await snapshot(recipient, 'recipient-bell');
    await item.getByTestId('notification-item-link').click();
    await expect(recipient.getByTestId('announcement-message-page')).toBeVisible();
    await expect(recipient.getByTestId('announcement-message-title')).toHaveText(title);
    await expect(recipient.getByTestId('announcement-message-body')).toContainText(body);
    await snapshot(recipient, 'announcement-message');
    await recipientContext.close();
  });

  // 事件管理（docs/architecture/backend/16-notification-events.md）：租戶允許個人覆寫 → 個人關掉 → 之後的公告不再送給他
  test('租戶允許個人調整後，收件人在偏好設定關掉公告通知 → 之後發布的公告不會送給他', async ({
    page,
    browser,
  }) => {
    const superToken = await apiLogin('superAdmin');
    const recipientToken = await apiLogin('announceTarget');
    try {
      // ① super-admin：事件管理允許個人調整「公告」的站內通知
      await loginAndWaitForHome(page, 'superAdmin');
      await page.goto('/system/notification-events');
      const channel = getByTestIdAndValue(
        getByTestIdAndValue(page, 'notification-event-row', ANNOUNCEMENT_TYPE),
        'notification-event-channel',
        'inApp',
      );
      await channel.getByTestId('notification-event-allow-override').click();
      await page.getByTestId('notification-event-save').click();
      await expect(page.getByTestId('notification-event-save')).toHaveCount(0);

      // ② 收件人：偏好設定的開關解鎖 → 關掉
      const recipientContext = await browser.newContext();
      const recipient = await recipientContext.newPage();
      await loginAndWaitForHome(recipient, 'announceTarget');
      await recipient.goto('/preference');
      const preference = getByTestIdAndValue(
        getByTestIdAndValue(recipient, 'notification-preference-row', ANNOUNCEMENT_TYPE),
        'notification-preference-channel',
        'inApp',
      );
      await expect(preference.getByTestId('notification-preference-lock')).toHaveCount(0);
      const toggle = preference.getByTestId('notification-preference-switch');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await snapshot(recipient, 'preference-off');
      await recipientContext.close();

      // ③ 發布給他的公告：展開完成後，他的通知裡沒有這一則
      const adminToken = await apiLogin('admin');
      const title = unique('E2E 不通知');
      const created = await apiRequest(adminToken, 'post', '/announcements', {
        title,
        body: 'E2E',
        audience: {
          all: false,
          userIds: [await userIdOf(adminToken, ACCOUNTS.announceTarget)],
          groupIds: [],
          roleIds: [],
        },
        trigger: { kind: 'immediate' },
      });
      const announcement = (created.body as { data: { id: string; version: number } }).data;
      const published = await apiRequest(
        adminToken,
        'post',
        `/announcements/${announcement.id}/publish`,
        { version: announcement.version },
      );
      expect(published.status).toBe(200);
      await expect
        .poll(async () => {
          const dispatches = await apiRequest(
            adminToken,
            'get',
            `/announcements/${announcement.id}/dispatches`,
          );
          return (dispatches.body as { data: { items: Array<{ status: string }> } }).data.items[0]
            ?.status;
        })
        .toBe('sent');
      const notifications = await apiRequest(recipientToken, 'get', '/notifications?limit=100');
      const items = (
        notifications.body as {
          data: { items: Array<{ type: string; params: { title?: string } }> };
        }
      ).data.items;
      expect(items.filter((item) => item.params.title === title)).toHaveLength(0);
    } finally {
      await apiRequest(recipientToken, 'patch', '/me/notification-preferences', {
        changes: [{ type: ANNOUNCEMENT_TYPE, channel: 'inApp', enabled: null }],
      });
      await apiRequest(superToken, 'patch', '/notification-events', {
        changes: [{ type: ANNOUNCEMENT_TYPE, channel: 'inApp', allowUserOverride: false }],
      });
    }
  });

  test('收件人是空的不能發布（ANNOUNCEMENT_AUDIENCE_EMPTY）', async () => {
    const token = await apiLogin('admin');
    const created = await apiRequest(token, 'post', '/announcements', {
      title: unique('E2E 空收件人'),
      body: 'E2E',
      audience: { all: false, userIds: [], groupIds: [], roleIds: [] },
      trigger: { kind: 'immediate' },
    });
    expect(created.status).toBe(201);
    const announcement = (created.body as { data: { id: string; version: number } }).data;

    const published = await apiRequest(token, 'post', `/announcements/${announcement.id}/publish`, {
      version: announcement.version,
    });
    expect(published.status).toBe(400);
    expect(published.body).toMatchObject({ error: { code: 'ANNOUNCEMENT_AUDIENCE_EMPTY' } });

    await apiRequest(token, 'delete', `/announcements/${announcement.id}`);
  });

  test('auditor 看得到公告列表，但沒有建立按鈕', async ({ page }) => {
    await loginAndWaitForHome(page, 'auditor');
    await page.goto('/announcement');
    await expect(page.getByTestId('announcement-list-page')).toBeVisible();
    await expect(page.getByTestId('announcement-create-button')).toHaveCount(0);
    await page.goto('/announcement/create');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
  });

  test('member 沒有公告選單，直接進網址是 403 頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await expect(page.getByTestId('menu-announcement')).toHaveCount(0);
    await page.goto('/announcement');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
  });
});
