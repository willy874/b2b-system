import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerApprovalPagePermissions, Routes } from '../../..';
import approvalZhTW from '../../../locales/zh_TW.json';

const { fetchList } = vi.hoisted(() => ({ fetchList: vi.fn() }));
vi.mock('@/apis/approval/get-approval-list/fetcher', () => ({ fetchApprovalListQuery: fetchList }));

const REVIEWER = ['approval:read', 'approval:review'] as PermissionKey[];
const routes = [Routes.ApprovalListRoute];

beforeAll(() => initTestI18n(approvalZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalPagePermissions();
  fetchList.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('ApprovalListPage（docs/architecture/frontend/07-ui-system.md §6.1）', () => {
  it('查詢失敗 → 顯示錯誤與重試，不落到「沒有資料」（審核者不會以為沒有待審的申請）', async () => {
    fetchList.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, '/approval', REVIEWER);

    expect(
      await screen.findByTestId('rich-table-error', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('沒有資料')).toBeNull();

    fetchList.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
    fireEvent.click(screen.getByTestId('query-error-retry'));
    expect(await screen.findByText('沒有資料')).toBeInTheDocument();
  });
});

describe('ApprovalListPage 的匯出（docs/architecture/backend/22-data-transfer.md §12.5）', () => {
  afterEach(() => {
    featureStore.setState({ resolved: true, statuses: new Map() });
  });

  it('有 approval:export → 匯出可以選請求或審核紀錄；沒有就不顯示', async () => {
    fetchList.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
    featureStore.setState({ resolved: true, statuses: new Map([['dataTransfer', 'ready']]) });
    renderRoute(routes, '/approval', [...REVIEWER, 'approval:export'] as PermissionKey[]);
    fireEvent.click(
      await screen.findByTestId('approval-export-button', undefined, { timeout: 5000 }),
    );
    expect(await screen.findByText('審核紀錄（每一關的決定）')).toBeInTheDocument();
  });

  it('沒有 approval:export → 不顯示匯出', async () => {
    fetchList.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
    featureStore.setState({ resolved: true, statuses: new Map([['dataTransfer', 'ready']]) });
    renderRoute(routes, '/approval', REVIEWER);
    await screen.findByText('沒有資料', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('approval-export-button')).toBeNull();
  });
});
