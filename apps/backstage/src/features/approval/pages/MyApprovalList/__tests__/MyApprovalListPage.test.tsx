import { renderRoute } from '@b2b-system/web-core/testing';
import { screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature/store';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerApprovalPagePermissions, Routes } from '../../..';
import approvalZhTW from '../../../locales/zh_TW.json';

const { fetchList } = vi.hoisted(() => ({ fetchList: vi.fn() }));
vi.mock('@/apis/approval/get-approval-list/fetcher', () => ({ fetchApprovalListQuery: fetchList }));

const routes = [Routes.MyApprovalRoute];

function setChainEnabled(enabled: boolean): void {
  featureStore.setState({
    resolved: true,
    statuses: new Map([['approvalChain', enabled ? 'ready' : 'disabled']]),
  });
}

beforeAll(() => initTestI18n(approvalZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalPagePermissions();
  fetchList.mockReset();
  fetchList.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => setChainEnabled(false));

describe('我的審批（docs/architecture/backend/20-approval.md §9.10）', () => {
  it('多階段已啟用：預設「待我審核」，以 scope=assigned 查詢；不需要任何權限', async () => {
    setChainEnabled(true);
    renderRoute(routes, '/my-approvals', []);
    expect(await screen.findByTestId('my-approval-page')).toBeInTheDocument();
    expect(screen.getByText('待我審核')).toBeInTheDocument();
    expect(screen.getByText('我的申請')).toBeInTheDocument();
    expect(fetchList).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ scope: 'assigned' }) }),
    );
  });

  it('多階段未啟用：只有「我的申請」', async () => {
    setChainEnabled(false);
    renderRoute(routes, '/my-approvals', []);
    expect(await screen.findByTestId('my-approval-page')).toBeInTheDocument();
    expect(screen.queryByText('待我審核')).not.toBeInTheDocument();
    expect(fetchList).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ scope: 'mine' }) }),
    );
  });
});
