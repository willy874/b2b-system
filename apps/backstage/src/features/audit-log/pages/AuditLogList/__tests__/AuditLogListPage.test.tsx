import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { AUDIT_LOG_FEATURE, registerAuditLogPagePermissions, Routes } from '../../..';
import auditLogZhTW from '../../../locales/zh_TW.json';

const { fetchList } = vi.hoisted(() => ({ fetchList: vi.fn() }));
vi.mock('@/apis/audit-log/get-audit-log-list/fetcher', () => ({
  fetchAuditLogListQuery: fetchList,
}));

const routes = [Routes.AuditLogListRoute];

beforeAll(() => initTestI18n(auditLogZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerAuditLogPagePermissions();
  featureStore.setState({ resolved: true, statuses: new Map([[AUDIT_LOG_FEATURE, 'ready']]) });
  fetchList.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('AuditLogListPage（docs/architecture/frontend/07-ui-system.md §6.1）', () => {
  it('查詢失敗 → 顯示錯誤與重試，不落到「沒有資料」', async () => {
    fetchList.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, '/audit-log', ['auditLog:read'] as PermissionKey[]);

    expect(
      await screen.findByTestId('rich-table-error', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('沒有資料')).toBeNull();

    fetchList.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 50, total: 0 } });
    fireEvent.click(screen.getByTestId('query-error-retry'));
    expect(await screen.findByText('沒有資料')).toBeInTheDocument();
  });

  it('依序到下一頁時以上一頁的 nextCursor 取（不送 offset）；跳回第一頁照舊用 offset', async () => {
    const page = (offset: number, nextCursor: string | null) => ({
      items: Array.from({ length: 50 }, (_, i) => ({
        id: String(1000 - offset - i),
        occurredAt: '2026-10-05T12:00:00.000Z',
        actorId: null,
        actorEmail: 'system',
        action: 'role.update',
        resourceType: 'role',
        resourceId: null,
        resourceName: null,
        result: 'success' as const,
        errorCode: null,
      })),
      pagination: { offset, limit: 50, total: 120 },
      nextCursor,
    });
    fetchList.mockImplementation(
      async ({ params }: { params: { offset: number; cursor?: string } }) =>
        page(params.cursor ? 50 : params.offset, params.cursor ? 'cursor-2' : 'cursor-1'),
    );
    renderRoute(routes, '/audit-log', ['auditLog:read'] as PermissionKey[]);
    await waitFor(() => expect(fetchList).toHaveBeenCalledTimes(1));
    expect(fetchList.mock.calls[0]?.[0].params).toMatchObject({ offset: 0, cursor: undefined });

    fireEvent.click(await screen.findByTestId('pagination-next'));
    await waitFor(() => expect(fetchList).toHaveBeenCalledTimes(2));
    expect(fetchList.mock.calls[1]?.[0].params).toMatchObject({ offset: 50, cursor: 'cursor-1' });
  });

  it('總數到達上限 → 摘要寫「以上」，「最後一頁」的 offset 不超過 10,000（docs/architecture/backend/06-audit-log.md §7.2）', async () => {
    fetchList.mockImplementation(async ({ params }: { params: { offset: number } }) => ({
      items: [],
      pagination: { offset: params.offset, limit: 50, total: 10_100 },
      nextCursor: null,
    }));
    renderRoute(routes, '/audit-log', ['auditLog:read'] as PermissionKey[]);
    const summary = await screen.findByTestId('pagination-summary', undefined, { timeout: 5000 });
    await waitFor(() => expect(summary).toHaveTextContent('10,100 筆以上'));

    fireEvent.click(screen.getByTestId('pagination-last'));
    await waitFor(() =>
      expect(fetchList.mock.lastCall?.[0].params).toMatchObject({ offset: 10_000 }),
    );
  });

  it('網址帶超過上限的 offset → 回到第一頁，不送出會 400 的請求', async () => {
    fetchList.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 50, total: 0 } });
    renderRoute(routes, '/audit-log?offset=20000', ['auditLog:read'] as PermissionKey[]);
    await waitFor(() => expect(fetchList).toHaveBeenCalled());
    expect(fetchList.mock.calls[0]?.[0].params).toMatchObject({ offset: 0 });
  });
});
