import { expect, test } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { loginAndWaitForHome } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 留言與關注（docs/architecture/backend/24-comment.md）：admin 在使用者詳情留言並提及 auditor → auditor 收到通知、
 * 點進去看得到留言但不能改；admin 刪除留言。被留言的使用者在測試內以 API 建立，不影響其他 spec。
 */

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

interface NotificationBody {
  id: string;
  type: string;
  link: { route: string; params: Record<string, string> } | null;
}

test.describe('留言與關注（docs/architecture/backend/24-comment.md）', () => {
  test('留言並提及 → 被提及的人收到通知、看得到但不能改；作者自動關注；刪除', async ({
    page,
    browser,
  }) => {
    const adminToken = await apiLogin('admin');
    const auditorToken = await apiLogin('auditor');
    const created = await apiRequest(adminToken, 'post', '/users', {
      email: `${unique('e2e-commented')}@dev.local`,
      displayName: 'E2E Commented',
    });
    expect(created.status).toBe(201);
    const userId = (created.body as { data: { id: string } }).data.id;
    const profile = await apiRequest(auditorToken, 'get', '/auth/profile');
    const auditorId = (profile.body as { data: { user: { id: string } } }).data.user.id;
    const body = unique('請確認權限');

    // ① admin：在使用者詳情留言並提及 auditor
    await loginAndWaitForHome(page, 'admin');
    await page.goto(`/user/${userId}`);
    const panel = page.getByTestId('user-detail-dialog').getByTestId('comment-panel');
    await expect(panel.getByTestId('comment-empty')).toBeVisible();
    await panel.getByTestId('comment-editor-body').fill(body);
    await panel.getByTestId('comment-editor-mentions').click();
    await page.getByTestId('select-search').fill('e2e-auditor');
    await getByTestIdAndValue(page, 'select-item', auditorId).click();
    await page.keyboard.press('Escape');
    await panel.getByTestId('comment-editor-submit').click();
    const item = panel.getByTestId('comment-item').first();
    await expect(item.getByTestId('comment-body')).toHaveText(body);
    await expect(item.getByTestId('comment-mentions')).toBeVisible();
    // 作者自動關注
    await expect(panel.getByTestId('comment-watch-button')).toHaveAttribute(
      'data-value',
      'watching',
    );
    await snapshot(page, 'comment-created');

    // ② auditor：收到提及的通知，連到使用者詳情；看得到留言、沒有操作選單
    const notifications = await apiRequest(auditorToken, 'get', '/notifications?limit=20');
    const mentioned = (
      notifications.body as { data: { items: NotificationBody[] } }
    ).data.items.find(
      (notification) =>
        notification.type === 'comment.mentioned' && notification.link?.params.userId === userId,
    );
    expect(mentioned?.link).toEqual({ route: 'user.detail', params: { userId } });

    const auditorContext = await browser.newContext();
    const auditorPage = await auditorContext.newPage();
    await loginAndWaitForHome(auditorPage, 'auditor');
    await auditorPage.goto(`/user/${userId}`);
    const auditorPanel = auditorPage.getByTestId('user-detail-dialog').getByTestId('comment-panel');
    await expect(auditorPanel.getByTestId('comment-body')).toHaveText(body);
    await expect(auditorPanel.getByTestId('comment-actions')).toHaveCount(0);
    await auditorContext.close();

    // ③ admin：刪除自己的留言
    await item.getByTestId('comment-actions').click();
    await page.getByRole('menuitem', { name: '刪除' }).click();
    await page.getByTestId('comment-delete-confirm').getByTestId('alert-dialog-confirm').click();
    await expect(panel.getByTestId('comment-empty')).toBeVisible();
  });
  test('關注：有人留言或修改資源 → 關注者收到通知；取消關注後不再收到', async ({ page }) => {
    const adminToken = await apiLogin('admin');
    const auditorToken = await apiLogin('auditor');
    const created = await apiRequest(adminToken, 'post', '/users', {
      email: `${unique('e2e-watched')}@dev.local`,
      displayName: 'E2E Watched',
    });
    expect(created.status).toBe(201);
    const user = (created.body as { data: { id: string; version: number } }).data;
    const notificationsFor = async (type: string) =>
      (
        (await apiRequest(auditorToken, 'get', '/notifications?limit=50')).body as {
          data: { items: NotificationBody[] };
        }
      ).data.items.filter(
        (notification) =>
          notification.type === type && notification.link?.params.userId === user.id,
      );

    // ① auditor（只有 user:read）關注這個使用者
    await loginAndWaitForHome(page, 'auditor');
    await page.goto(`/user/${user.id}`);
    const panel = page.getByTestId('user-detail-dialog').getByTestId('comment-panel');
    const watch = panel.getByTestId('comment-watch-button');
    await expect(watch).toHaveAttribute('data-value', 'idle');
    await watch.click();
    await expect(watch).toHaveAttribute('data-value', 'watching');

    // ② admin 留言 → 關注者收到 comment.created（同一個交易寫入）
    const posted = await apiRequest(adminToken, 'post', `/comments/user/${user.id}`, {
      body: unique('第一則'),
    });
    expect(posted.status).toBe(201);
    expect(await notificationsFor('comment.created')).toHaveLength(1);

    // ③ admin 修改資源 → 背景工作 watch.notify 送出 watch.resourceUpdated
    const patched = await apiRequest(adminToken, 'patch', `/users/${user.id}`, {
      displayName: 'E2E Watched Renamed',
      version: user.version,
    });
    expect(patched.status).toBe(200);
    await expect.poll(async () => (await notificationsFor('watch.resourceUpdated')).length).toBe(1);

    // ④ 取消關注 → 之後的留言不再通知
    await watch.click();
    await expect(watch).toHaveAttribute('data-value', 'idle');
    await snapshot(page, 'unwatched');
    const again = await apiRequest(adminToken, 'post', `/comments/user/${user.id}`, {
      body: unique('第二則'),
    });
    expect(again.status).toBe(201);
    expect(await notificationsFor('comment.created')).toHaveLength(1);
  });

  test('作者編輯自己的留言 → 標示已編輯；管理者刪除別人的留言', async ({ page, browser }) => {
    const adminToken = await apiLogin('admin');
    const created = await apiRequest(adminToken, 'post', '/users', {
      email: `${unique('e2e-edited')}@dev.local`,
      displayName: 'E2E Edited',
    });
    const userId = (created.body as { data: { id: string } }).data.id;
    const original = unique('原本的內容');
    const edited = unique('改過的內容');

    // ① auditor 留言後自己編輯
    const auditorContext = await browser.newContext();
    const auditor = await auditorContext.newPage();
    await loginAndWaitForHome(auditor, 'auditor');
    await auditor.goto(`/user/${userId}`);
    const auditorPanel = auditor.getByTestId('user-detail-dialog').getByTestId('comment-panel');
    await auditorPanel.getByTestId('comment-editor-body').fill(original);
    await auditorPanel.getByTestId('comment-editor-submit').click();
    const auditorItem = auditorPanel.getByTestId('comment-item').first();
    await expect(auditorItem.getByTestId('comment-body')).toHaveText(original);
    await auditorItem.getByTestId('comment-actions').click();
    await getByTestIdAndValue(auditor, 'menu-item', 'edit').click();
    const editor = auditorItem.getByTestId('comment-edit-editor');
    await editor.getByTestId('comment-editor-body').fill(edited);
    await editor.getByTestId('comment-editor-submit').click();
    await expect(auditorItem.getByTestId('comment-body')).toHaveText(edited);
    await expect(auditorItem.getByTestId('comment-edited')).toBeVisible();
    await snapshot(auditor, 'comment-edited');
    await auditorContext.close();

    // ② admin（comment:delete）看得到操作選單，可以刪除別人的留言
    await loginAndWaitForHome(page, 'admin');
    await page.goto(`/user/${userId}`);
    const panel = page.getByTestId('user-detail-dialog').getByTestId('comment-panel');
    const item = panel.getByTestId('comment-item').first();
    await expect(item.getByTestId('comment-body')).toHaveText(edited);
    await item.getByTestId('comment-actions').click();
    await getByTestIdAndValue(page, 'menu-item', 'delete').click();
    await page.getByTestId('comment-delete-confirm').getByTestId('alert-dialog-confirm').click();
    await expect(panel.getByTestId('comment-empty')).toBeVisible();

    // 刪除別人的留言寫入稽核
    const logs = await apiRequest(adminToken, 'get', '/audit-logs?action=comment.delete&limit=20');
    expect(
      (logs.body as { data: { items: Array<{ action: string }> } }).data.items.length,
    ).toBeGreaterThan(0);
  });
});
