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
});
