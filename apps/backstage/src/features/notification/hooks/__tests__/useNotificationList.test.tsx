import { createRootRoute, createRoute } from '@tanstack/react-router';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/core/auth';
import { registerRouteLink, resetRouteLinkRegistry } from '@/core/route-link';
import type { Notification } from '@/shared/api-sdk';
import { AllProviders } from '@/test/renderWithPermissions';

import { useNotificationList } from '../useNotificationList';

const { fetchList } = vi.hoisted(() => ({ fetchList: vi.fn() }));
vi.mock('@/apis/notification/get-notification-list/fetcher', () => ({
  fetchNotificationListQuery: fetchList,
}));

const root = createRootRoute();
const approvalDetail = createRoute({ getParentRoute: () => root, path: '/approval/$approvalId' });

function notification(id: string, route = 'approval.detail'): Notification {
  return {
    id,
    type: 'approval.pending',
    params: { approvalType: 'user.register', requesterName: 'a@b.c', subject: 'A' },
    link: { route, params: { approvalId: `approval-${id}` } },
    actor: null,
    readAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  sessionStore.presumeSession();
  resetRouteLinkRegistry();
  registerRouteLink('approval.detail', {
    route: approvalDetail,
    params: { approvalId: 'approvalId' },
  });
  fetchList.mockReset();
});

afterEach(() => sessionStore.clear());

describe('useNotificationList（keyset 無限捲動）', () => {
  it('轉成 view model；登記過的 route id 解析成連結，沒登記的不可點', async () => {
    fetchList.mockResolvedValue({
      items: [notification('n1'), notification('n2', 'unknown.page')],
      nextCursor: null,
    });
    const { result } = renderHook(() => useNotificationList('all'), { wrapper: AllProviders });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items[0]?.link).toEqual({
      to: '/approval/$approvalId',
      params: { approvalId: 'approval-n1' },
      search: {},
    });
    expect(result.current.items[1]?.link).toBeUndefined();
    expect(result.current.hasMore).toBe(false);
  });

  it('未讀篩選帶到 API；下一頁以上一頁的 nextCursor 接續', async () => {
    fetchList
      .mockResolvedValueOnce({ items: [notification('n1')], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [notification('n2')], nextCursor: null });
    const { result } = renderHook(() => useNotificationList('unread'), { wrapper: AllProviders });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    expect(fetchList.mock.calls[0]![0].params).toMatchObject({
      filter: 'unread',
      cursor: undefined,
    });

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['n1', 'n2']));
    expect(fetchList.mock.calls[1]![0].params).toMatchObject({
      filter: 'unread',
      cursor: 'cursor-1',
    });
  });

  it('enabled: false（鈴鐺關著）或沒有 session 時不抓', async () => {
    renderHook(() => useNotificationList('all', { enabled: false }), { wrapper: AllProviders });
    sessionStore.clear();
    renderHook(() => useNotificationList('all'), { wrapper: AllProviders });
    expect(fetchList).not.toHaveBeenCalled();
  });

  it('feature 在執行期登記 route id 之後，原本不可點的連結變成可點', async () => {
    fetchList.mockResolvedValue({ items: [notification('n1', 'late.page')], nextCursor: null });
    const { result } = renderHook(() => useNotificationList('all'), { wrapper: AllProviders });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]?.link).toBeUndefined();

    const late = createRoute({ getParentRoute: () => root, path: '/late/$approvalId' });
    act(() => {
      registerRouteLink('late.page', { route: late, params: { approvalId: 'approvalId' } });
    });
    expect(result.current.items[0]?.link?.to).toBe('/late/$approvalId');
  });
});
