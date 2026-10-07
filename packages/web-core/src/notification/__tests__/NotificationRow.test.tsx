import { createRoute } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { RootRoute } from '../../router';
import { initTestI18n } from '../../testing/i18n';
import { renderRoute } from '../../testing/renderRoute';
import { NotificationRow } from '../NotificationRow';
import type { NotificationRowProps } from '../NotificationRow';

beforeAll(() => initTestI18n());

const detailRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/detail/$id',
  component: () => <p data-testid="detail-page">detail</p>,
});

function renderRow(props: Partial<NotificationRowProps>) {
  const onOpen = vi.fn();
  const onMarkRead = vi.fn();
  const page = createRoute({
    getParentRoute: () => RootRoute,
    path: '/',
    component: () => (
      <NotificationRow
        id="n1"
        isRead={false}
        icon="bell"
        message="有一則通知"
        details={['補充']}
        actor="系統"
        createdAt={new Date().toISOString()}
        link={undefined}
        onOpen={onOpen}
        onMarkRead={onMarkRead}
        {...props}
      />
    ),
  });
  const result = renderRoute([page, detailRoute], '/', []);
  return { ...result, onOpen, onMarkRead };
}

describe('NotificationRow（鈴鐺與通知列表的一列，docs/architecture/frontend/15-notification.md §2）', () => {
  it('沒有連結的未讀通知：只顯示文字，列尾的「標為已讀」可以按', async () => {
    const { onMarkRead, onOpen } = renderRow({});
    const item = await screen.findByTestId('notification-item');
    expect(item.tagName).toBe('DIV');
    expect(item).toHaveAttribute('data-state', 'unread');
    expect(item).toHaveTextContent('有一則通知');
    expect(item).toHaveTextContent('補充');
    expect(item).toHaveTextContent('系統 ·');

    await userEvent.click(screen.getByRole('button', { name: '標為已讀' }));
    expect(onMarkRead).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('有連結：是 <a>，點了呼叫 onOpen 並換頁；按鈕不在連結裡面', async () => {
    const { onOpen, router } = renderRow({
      link: { to: '/detail/$id', params: { id: 'd1' }, search: {} },
    });
    const item = await screen.findByTestId('notification-item');
    expect(item.tagName).toBe('A');
    expect(within(item).queryByRole('button')).toBeNull();

    await userEvent.click(item);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/detail/d1');
  });

  it('已讀：沒有「標為已讀」；沒有觸發者時只顯示時間', async () => {
    renderRow({ isRead: true, actor: undefined });
    const item = await screen.findByTestId('notification-item');
    expect(item).toHaveAttribute('data-state', 'read');
    expect(screen.queryByTestId('notification-item-mark-read')).toBeNull();
    expect(item).not.toHaveTextContent('·');
  });
});
