import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderRoute } from '@b2b-system/web-core/testing';
import { renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry, usePageAccess } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerAnnouncementPagePermissions, Routes } from '../../..';
import zhTW from '../../../locales/zh_TW.json';

const { fetchList } = vi.hoisted(() => ({ fetchList: vi.fn() }));
vi.mock('@/apis/announcement/get-announcement-list/fetcher', () => ({
  fetchAnnouncementListQuery: fetchList,
}));

export const ANNOUNCEMENT = {
  id: 'a1',
  title: '系統維護通知',
  body: '週六停機',
  audience: { all: true, userIds: [], groupIds: [], roleIds: [] },
  trigger: { kind: 'immediate' },
  status: 'completed',
  nextRunAt: null,
  lastDispatch: {
    id: 'd1',
    status: 'sent',
    scheduledFor: '2026-10-01T00:00:00.000Z',
    recipientCount: 10,
    readCount: 4,
  },
  version: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  createdBy: null,
  updatedBy: null,
};
const MANAGER = ['announcement:read', 'announcement:create'] as PermissionKey[];
const routes = [Routes.AnnouncementListRoute];

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerAnnouncementPagePermissions();
  fetchList.mockReset().mockResolvedValue({
    items: [ANNOUNCEMENT],
    pagination: { offset: 0, limit: 20, total: 1 },
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('AnnouncementListPage（docs/architecture/backend/19-announcement.md §9 A2）', () => {
  it('有 announcement:create → 列出公告（狀態、已讀率）並顯示建立按鈕', async () => {
    renderRoute(routes, '/announcement', MANAGER);
    expect(await screen.findByText('系統維護通知', undefined, { timeout: 5000 })).toBeVisible();
    expect(screen.getByTestId('announcement-status')).toHaveTextContent('已完成');
    expect(screen.getByText('4 / 10')).toBeInTheDocument();
    expect(screen.getByTestId('announcement-create-button')).toBeInTheDocument();
  });

  it('只有 announcement:read → 看得到列表，沒有建立按鈕', async () => {
    renderRoute(routes, '/announcement', ['announcement:read'] as PermissionKey[]);
    await screen.findByText('系統維護通知', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('announcement-create-button')).toBeNull();
  });

  it('權限未水合 → 不閃現建立按鈕', async () => {
    renderRoute(routes, '/announcement', 'unhydrated');
    await waitFor(() => expect(screen.queryByTestId('announcement-create-button')).toBeNull());
  });

  it('頁面權限：列表要 announcement:read；全文頁 /announcement/message/… 只需要登入', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: true });
    expect(renderHook(() => usePageAccess('/announcement')).result.current.canAccess).toBe(false);
    expect(
      renderHook(() => usePageAccess('/announcement/message/d1')).result.current,
    ).toMatchObject({ gated: false, canAccess: true });
  });
});
