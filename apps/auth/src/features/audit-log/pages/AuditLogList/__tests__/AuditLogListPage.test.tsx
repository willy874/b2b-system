import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformAuditLogListParams } from '@/apis/platform-audit-log/types';
import { resetPagePermissionRegistry } from '@/core/permission';
import { parseSearch, RootRoute, stringifySearch } from '@/core/router';
import { usePermissionStore } from '@/core/store';
import { AllProviders } from '@/test/renderWithPermissions';

import { registerAuditLogPagePermissions, Routes } from '../../..';
import { auditLogFixture } from '../../../test-fixtures';

const { listAuditLogs } = vi.hoisted(() => ({ listAuditLogs: vi.fn() }));
vi.mock('@/apis/platform-audit-log/get-audit-log-list/query', () => ({
  PLATFORM_AUDIT_LOG_LIST_QUERY_KEY: 'PLATFORM_AUDIT_LOG_LIST_QUERY_KEY',
  getPlatformAuditLogListQueryOptions: ({ params }: { params: PlatformAuditLogListParams }) => ({
    queryKey: ['PLATFORM_AUDIT_LOG_LIST_QUERY_KEY', params],
    queryFn: () => listAuditLogs(params),
  }),
}));

const SUCCESS = auditLogFixture();
const FAILURE = auditLogFixture({
  id: '88888888-8888-4888-8888-888888888888',
  action: 'tenant.delete',
  result: 'failure',
  errorCode: 'TENANT_STATUS_CONFLICT',
  metadata: null,
});

function renderPage(initialEntry = '/audit-log') {
  usePermissionStore.setState({
    permissions: new Set(['platformAuditLog:read']),
    hydrated: true,
  });
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.AuditLogListRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    parseSearch,
    stringifySearch,
  });
  render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
  return router;
}

const lastParams = () => listAuditLogs.mock.lastCall?.[0] as PlatformAuditLogListParams;

beforeEach(() => {
  resetPagePermissionRegistry();
  registerAuditLogPagePermissions();
  listAuditLogs.mockReset().mockResolvedValue({
    items: [SUCCESS, FAILURE],
    pagination: { offset: 0, limit: 50, total: 120 },
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('平台稽核', () => {
  it('列出紀錄：動作與結果', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('audit-log-action')).toHaveLength(2));
    expect(
      screen.getAllByTestId('audit-log-action').map((el) => el.getAttribute('data-value')),
    ).toEqual(['tenant.create', 'tenant.delete']);
    expect(
      screen.getAllByTestId('audit-log-result').map((el) => el.getAttribute('data-value')),
    ).toEqual(['success', 'failure']);
    expect(lastParams()).toEqual({
      offset: 0,
      limit: 50,
      action: undefined,
      actorEmail: undefined,
      result: undefined,
    });
  });

  it('動作與操作者信箱：按搜尋才送出，並回到第一頁', async () => {
    const router = renderPage('/audit-log?offset=50');
    await screen.findAllByTestId('audit-log-action');
    expect(lastParams().offset).toBe(50);

    fireEvent.change(screen.getByTestId('audit-log-filter-action'), {
      target: { value: ' tenant.* ' },
    });
    fireEvent.change(screen.getByTestId('audit-log-filter-actor-email'), {
      target: { value: 'root' },
    });
    expect(lastParams().action).toBeUndefined();

    fireEvent.click(screen.getByTestId('audit-log-filter-submit'));
    await waitFor(() =>
      expect(lastParams()).toEqual({
        offset: 0,
        limit: 50,
        action: 'tenant.*',
        actorEmail: 'root',
        result: undefined,
      }),
    );
    // 等於預設值的 offset、limit 不寫進網址
    expect(router.state.location.search).toEqual({ action: 'tenant.*', actorEmail: 'root' });

    // 重設：清掉所有條件
    fireEvent.click(screen.getByTestId('audit-log-filter-reset'));
    await waitFor(() => expect(lastParams().action).toBeUndefined());
    expect(lastParams().actorEmail).toBeUndefined();
    expect(screen.getByTestId('audit-log-filter-action')).toHaveValue('');
  });

  it('結果篩選：選了就重新查詢；選「全部」拿掉條件', async () => {
    renderPage('/audit-log?action=tenant.*');
    await screen.findAllByTestId('audit-log-action');

    await userEvent.click(screen.getByTestId('audit-log-filter-result'));
    await userEvent.click(
      await waitFor(() => {
        const item = document.querySelector<HTMLElement>(
          '[data-testid="select-item"][data-value="failure"]',
        );
        if (!item) throw new Error('找不到 failure 選項');
        return item;
      }),
    );
    await waitFor(() => expect(lastParams().result).toBe('failure'));
    // 其他條件保留
    expect(lastParams().action).toBe('tenant.*');

    await userEvent.click(screen.getByTestId('audit-log-filter-result'));
    await userEvent.click(
      await waitFor(() => {
        const item = document.querySelector<HTMLElement>(
          '[data-testid="select-item"][data-value="all"]',
        );
        if (!item) throw new Error('找不到 all 選項');
        return item;
      }),
    );
    await waitFor(() => expect(lastParams().result).toBeUndefined());
  });

  it('分頁：下一頁帶 offset', async () => {
    renderPage();
    await screen.findAllByTestId('audit-log-action');
    fireEvent.click(screen.getByTestId('pagination-next'));
    await waitFor(() => expect(lastParams().offset).toBe(50));
    expect(lastParams().limit).toBe(50);
  });

  it('展開列：metadata 以 JSON 顯示；沒有 metadata 時顯示空狀態與錯誤碼', async () => {
    renderPage();
    await screen.findAllByTestId('audit-log-action');
    expect(screen.queryByTestId('audit-log-detail')).toBeNull();

    fireEvent.click(
      screen
        .getAllByTestId('audit-log-expand')
        .find((el) => el.getAttribute('data-value') === SUCCESS.id)!,
    );
    const metadata = await screen.findByTestId('audit-log-metadata');
    expect(JSON.parse(metadata.textContent ?? '')).toEqual(SUCCESS.metadata);

    // 一次只展開一列
    fireEvent.click(
      screen
        .getAllByTestId('audit-log-expand')
        .find((el) => el.getAttribute('data-value') === FAILURE.id)!,
    );
    expect(await screen.findByTestId('audit-log-metadata-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-log-metadata')).toBeNull();
    expect(screen.getByTestId('audit-log-error-code')).toHaveTextContent('TENANT_STATUS_CONFLICT');
  });
});
