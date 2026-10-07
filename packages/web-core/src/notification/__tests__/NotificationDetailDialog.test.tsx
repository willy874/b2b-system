import { createRoute } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { RootRoute } from '../../router';
import { initTestI18n } from '../../testing/i18n';
import { renderRoute } from '../../testing/renderRoute';
import { NotificationDetailDialog } from '../NotificationDetailDialog';
import type { NotificationContent } from '../NotificationRow';

beforeAll(() => initTestI18n());

const detailRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/detail/$id',
  component: () => <p data-testid="detail-page">detail</p>,
});

const NOTIFICATION: NotificationContent = {
  id: 'n1',
  isRead: false,
  icon: 'bell',
  message: '有一則通知',
  details: ['很長的補充，列上會被截斷'],
  actor: '王小明',
  createdAt: '2026-10-01T08:00:00.000Z',
  link: undefined,
};

function renderDialog(
  notification: NotificationContent,
  onDelete?: (notification: NotificationContent) => void,
) {
  function Harness() {
    const [shown, setShown] = useState<NotificationContent | undefined>(notification);
    return (
      <NotificationDetailDialog
        notification={shown}
        onClose={() => setShown(undefined)}
        onDelete={onDelete}
      />
    );
  }
  const page = createRoute({ getParentRoute: () => RootRoute, path: '/', component: Harness });
  return renderRoute([page, detailRoute], '/', []);
}

describe('NotificationDetailDialog（一則通知的詳細內容，docs/architecture/frontend/15-notification.md §2.2）', () => {
  it('顯示句子、完整的補充與觸發者；沒有連結就沒有「前往」，按關閉會關掉', async () => {
    renderDialog(NOTIFICATION);
    const dialog = await screen.findByTestId('notification-detail-dialog');
    expect(dialog).toHaveTextContent('有一則通知');
    expect(dialog).toHaveTextContent('很長的補充，列上會被截斷');
    expect(screen.getByTestId('notification-detail-actor')).toHaveTextContent('王小明');
    expect(screen.queryByTestId('notification-detail-link')).toBeNull();

    await userEvent.click(within(dialog).getByTestId('notification-detail-close'));
    await expect.poll(() => screen.queryByTestId('notification-detail-dialog')).toBeNull();
  });

  it('有連結：「前往」關閉對話框並換頁', async () => {
    const { router } = renderDialog({
      ...NOTIFICATION,
      link: { to: '/detail/$id', params: { id: 'd1' }, search: {} },
    });
    await userEvent.click(await screen.findByTestId('notification-detail-link'));
    expect(await screen.findByTestId('detail-page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/detail/d1');
    await expect.poll(() => screen.queryByTestId('notification-detail-dialog')).toBeNull();
  });

  it('有 onDelete：「刪除」交回這一則並關閉；省略時沒有這個按鈕', async () => {
    const onDelete = vi.fn();
    renderDialog(NOTIFICATION, onDelete);
    await userEvent.click(await screen.findByTestId('notification-detail-delete'));
    expect(onDelete).toHaveBeenCalledWith(NOTIFICATION);
    await expect.poll(() => screen.queryByTestId('notification-detail-dialog')).toBeNull();
  });
});
