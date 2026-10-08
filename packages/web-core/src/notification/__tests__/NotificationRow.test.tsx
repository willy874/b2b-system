import { createRoute } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { RootRoute } from '../../router';
import { initTestI18n } from '../../testing/i18n';
import { renderRoute } from '../../testing/renderRoute';
import { bindNotificationRowActions, NotificationRow } from '../NotificationRow';
import type { NotificationContent, NotificationRowProps } from '../NotificationRow';

beforeAll(() => initTestI18n());

const detailRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/detail/$id',
  component: () => <p data-testid="detail-page">detail</p>,
});

function renderRow(props: Partial<NotificationRowProps>) {
  const onOpenDetail = vi.fn();
  const onFollowLink = vi.fn();
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
        onOpenDetail={onOpenDetail}
        onFollowLink={onFollowLink}
        onMarkRead={onMarkRead}
        {...props}
      />
    ),
  });
  const result = renderRoute([page, detailRoute], '/', []);
  return { ...result, onOpenDetail, onFollowLink, onMarkRead };
}

describe('NotificationRow（鈴鐺與通知列表的一列，docs/architecture/frontend/15-notification.md §2.1）', () => {
  it('沒有連結的未讀通知：整列可以點（打開詳細內容），沒有快速連結，列尾的「標為已讀」可以按', async () => {
    const { onMarkRead, onOpenDetail } = renderRow({});
    const item = await screen.findByTestId('notification-item');
    expect(item).toHaveAttribute('data-state', 'unread');
    expect(item).toHaveTextContent('有一則通知');
    expect(item).toHaveTextContent('補充');
    expect(item).toHaveTextContent('系統 ·');
    expect(within(item).queryByRole('link')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '標為已讀' }));
    expect(onMarkRead).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('notification-item-open'));
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it('有連結：點整列只打開詳細內容、不換頁；列尾的快速連結是 <a>，點了呼叫 onFollowLink 並換頁', async () => {
    const { onOpenDetail, onFollowLink, router } = renderRow({
      link: { to: '/detail/$id', params: { id: 'd1' }, search: {} },
    });
    const open = await screen.findByTestId('notification-item-open');
    expect(open.tagName).toBe('BUTTON');
    // 互動元素不互相包含
    expect(within(open).queryByRole('link')).toBeNull();
    expect(within(open).queryByRole('button')).toBeNull();

    await userEvent.click(open);
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/');

    const link = screen.getByRole('link', { name: '前往' });
    expect(link).toHaveAttribute('href', '/detail/d1');
    await userEvent.click(link);
    expect(onFollowLink).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/detail/d1');
  });

  it('已讀：沒有「標為已讀」；沒有觸發者時只顯示時間', async () => {
    renderRow({ isRead: true, actor: undefined });
    const item = await screen.findByTestId('notification-item');
    expect(item).toHaveAttribute('data-state', 'read');
    expect(screen.queryByTestId('notification-item-mark-read')).toBeNull();
    expect(item).not.toHaveTextContent('·');
  });

  it('沒有 selection 就沒有勾選框；有的話勾選不會打開詳細內容', async () => {
    const onCheckedChange = vi.fn();
    const { onOpenDetail } = renderRow({ selection: { checked: false, onCheckedChange } });
    await userEvent.click(await screen.findByRole('checkbox', { name: '選取：有一則通知' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('鈴鐺（沒有 selection）不顯示勾選框', async () => {
    renderRow({});
    await screen.findByTestId('notification-item');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('有 onDelete 時列尾有「刪除」，按了不會打開詳細內容；省略時沒有', async () => {
    const onDelete = vi.fn();
    const { onOpenDetail } = renderRow({ isRead: true, onDelete });
    await userEvent.click(await screen.findByRole('button', { name: '刪除' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });
});

describe('bindNotificationRowActions（把列表的動作綁到一則通知）', () => {
  const item = { id: 'n1' };
  const content: NotificationContent = {
    id: 'n1',
    isRead: false,
    icon: 'bell',
    message: '你被指派了新的角色',
    details: [],
    createdAt: '2026-10-08T00:00:00.000Z',
    link: undefined,
  };
  const actions = () => ({
    onOpenDetail: vi.fn(),
    onFollowLink: vi.fn(),
    onMarkRead: vi.fn(),
    onDelete: vi.fn(),
  });

  it('每個回呼都帶著這一則', () => {
    const list = actions();
    const bound = bindNotificationRowActions(item, content, list, false);

    bound.onOpenDetail();
    bound.onFollowLink();
    bound.onMarkRead();
    bound.onDelete?.();

    expect(list.onOpenDetail).toHaveBeenCalledWith(item, content);
    expect(list.onFollowLink).toHaveBeenCalledWith(item);
    expect(list.onMarkRead).toHaveBeenCalledWith(item);
    expect(list.onDelete).toHaveBeenCalledWith(item);
  });

  it('有 onSelectedChange 才有勾選，勾選狀態與變更都帶著這一則', () => {
    expect(bindNotificationRowActions(item, content, actions(), false).selection).toBeUndefined();

    const onSelectedChange = vi.fn();
    const { selection } = bindNotificationRowActions(
      item,
      content,
      { ...actions(), onSelectedChange },
      true,
    );
    expect(selection?.checked).toBe(true);
    selection?.onCheckedChange(false);
    expect(onSelectedChange).toHaveBeenCalledWith(item, false);
  });
});
