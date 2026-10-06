import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen } from '@testing-library/react';
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
});
