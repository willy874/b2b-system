import { renderRoute } from '@b2b-system/web-core/testing';
import { zonedDayBoundary } from '@b2b-system/web-shared/date';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformAuditLogListParams } from '@/apis/platform-audit-log/types';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerAuditLogPagePermissions, Routes } from '../../..';
import auditLogZhTW from '../../../locales/zh_TW.json';
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
  resourceId: null,
  result: 'failure',
  errorCode: 'TENANT_STATUS_CONFLICT',
  metadata: null,
});

const routes = [Routes.AuditLogListRoute];

function renderPage(initialPath = '/audit-log') {
  return renderRoute(routes, initialPath, ['platformAuditLog:read']);
}

const lastParams = () => listAuditLogs.mock.lastCall?.[0] as PlatformAuditLogListParams;

async function openFilters(): Promise<HTMLElement> {
  await userEvent.click(
    within(screen.getByTestId('audit-log-table')).getByTestId('filter-bar-trigger'),
  );
  return screen.findByTestId('filter-bar-popup');
}

const expandOf = (id: string) =>
  screen.getAllByTestId('audit-log-expand').find((el) => el.getAttribute('data-value') === id)!;

beforeAll(() => initTestI18n(auditLogZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerAuditLogPagePermissions();
  listAuditLogs.mockReset().mockResolvedValue({
    items: [SUCCESS, FAILURE],
    pagination: { offset: 0, limit: 50, total: 120 },
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('平台稽核（AuditLogListPage）', () => {
  it('列出紀錄：動作與結果；預設不帶任何條件', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('audit-log-action')).toHaveLength(2));
    expect(
      screen.getAllByTestId('audit-log-action').map((el) => el.getAttribute('data-value')),
    ).toEqual(['tenant.create', 'tenant.delete']);
    expect(
      screen.getAllByTestId('audit-log-result').map((el) => el.getAttribute('data-value')),
    ).toEqual(['success', 'failure']);
    // 失敗時顯示錯誤碼
    expect(screen.getAllByTestId('audit-log-result')[1]).toHaveTextContent(
      'TENANT_STATUS_CONFLICT',
    );
    expect(lastParams()).toEqual({
      offset: 0,
      limit: 50,
      action: undefined,
      actorEmail: undefined,
      result: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it('篩選面板：按搜尋才一次送出，回到第一頁並寫進網址', async () => {
    const { router } = renderPage('/audit-log?offset=50');
    await screen.findAllByTestId('audit-log-action');
    expect(lastParams().offset).toBe(50);

    await openFilters();
    await userEvent.type(screen.getByRole('textbox', { name: '動作' }), 'tenant.*');
    await userEvent.type(screen.getByRole('textbox', { name: '操作者信箱' }), 'root');
    expect(lastParams().action).toBeUndefined();

    await userEvent.click(screen.getByTestId('filter-bar-submit'));
    await waitFor(() =>
      expect(lastParams()).toMatchObject({
        offset: 0,
        action: 'tenant.*',
        actorEmail: 'root',
        result: undefined,
      }),
    );
    // 等於預設值的 offset、limit 不寫進網址
    expect(router.state.location.search).toEqual({ action: 'tenant.*', actorEmail: 'root' });
  });

  it('結果篩選：選「失敗」後送出，其他條件保留', async () => {
    renderPage('/audit-log?action=tenant.*');
    await screen.findAllByTestId('audit-log-action');

    await openFilters();
    await userEvent.click(screen.getByRole('combobox', { name: '結果' }));
    await userEvent.click(await screen.findByRole('option', { name: '失敗' }));
    await userEvent.click(screen.getByTestId('filter-bar-submit'));
    await waitFor(() => expect(lastParams().result).toBe('failure'));
    expect(lastParams().action).toBe('tenant.*');
  });

  it('網址上的日期區間 → 以偏好時區的日界線查詢', async () => {
    renderPage('/audit-log?from=2026-09-01&to=2026-09-02');
    await screen.findAllByTestId('audit-log-action');
    expect(lastParams()).toMatchObject({
      from: zonedDayBoundary('2026-09-01', 'start'),
      to: zonedDayBoundary('2026-09-02', 'end'),
    });
  });

  it('分頁：下一頁帶 offset', async () => {
    renderPage();
    await screen.findAllByTestId('audit-log-action');
    fireEvent.click(screen.getByTestId('pagination-next'));
    await waitFor(() => expect(lastParams().offset).toBe(50));
    expect(lastParams().limit).toBe(50);
  });

  it('展開列：metadata 以 JSON 顯示；沒有 metadata 時顯示空狀態與錯誤碼；一次只展開一列', async () => {
    renderPage();
    await screen.findAllByTestId('audit-log-action');
    expect(screen.queryByTestId('audit-log-detail')).toBeNull();

    fireEvent.click(expandOf(SUCCESS.id));
    const metadata = await screen.findByTestId('audit-log-metadata');
    expect(JSON.parse(metadata.textContent ?? '')).toEqual(SUCCESS.metadata);

    fireEvent.click(expandOf(FAILURE.id));
    expect(await screen.findByTestId('audit-log-metadata-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-log-metadata')).toBeNull();
    expect(screen.getByTestId('audit-log-error-code')).toHaveTextContent('TENANT_STATUS_CONFLICT');
  });
});
