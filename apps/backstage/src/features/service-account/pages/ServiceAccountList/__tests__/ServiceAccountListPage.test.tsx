import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { registerServiceAccountPagePermissions, Routes } from '../../..';
import serviceAccountZhTW from '../../../locales/zh_TW.json';

const { fetchAccounts, deleteAccount } = vi.hoisted(() => ({
  fetchAccounts: vi.fn(),
  deleteAccount: vi.fn(),
}));
vi.mock('@/apis/service-account/get-service-account-list/fetcher', () => ({
  fetchServiceAccountListQuery: fetchAccounts,
}));
vi.mock('@/apis/service-account/delete-service-account/fetcher', () => ({
  fetchServiceAccountDeleteMutation: deleteAccount,
}));

const account = (id: string, name: string, activeTokenCount: number) => ({
  id,
  name,
  status: 'active',
  roles: [{ id: 'r1', slug: 'auditor', name: '稽核人員', isSystem: true }],
  activeTokenCount,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
const MANAGER = [
  'serviceAccount:read',
  'serviceAccount:create',
  'serviceAccount:delete',
] as PermissionKey[];
const routes = [Routes.ServiceAccountListRoute];

beforeAll(() => initTestI18n(serviceAccountZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerServiceAccountPagePermissions();
  fetchAccounts.mockReset().mockResolvedValue({
    items: [account('sa1', 'CI 建置', 2), account('sa2', '報表同步', 0)],
    pagination: { offset: 0, limit: 20, total: 2 },
  });
  deleteAccount.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('ServiceAccountListPage（docs/architecture/06-external-api.md §9 T4）', () => {
  it('有 serviceAccount:create／delete → 顯示建立與刪除', async () => {
    renderRoute(routes, '/service-account', MANAGER);
    await screen.findByText('CI 建置', undefined, { timeout: 5000 });
    expect(screen.getByTestId('service-account-create-button')).toBeInTheDocument();
    expect(screen.getAllByTestId('service-account-delete-button')).toHaveLength(2);
  });

  it('只有 serviceAccount:read → 看得到列表，沒有建立與刪除', async () => {
    renderRoute(routes, '/service-account', ['serviceAccount:read'] as PermissionKey[]);
    await screen.findByText('CI 建置', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('service-account-create-button')).toBeNull();
    expect(screen.queryByTestId('service-account-delete-button')).toBeNull();
  });

  it('權限未水合 → 不閃現操作按鈕', async () => {
    renderRoute(routes, '/service-account', 'unhydrated');
    await waitFor(() => expect(screen.queryByTestId('service-account-create-button')).toBeNull());
    expect(screen.queryByTestId('service-account-delete-button')).toBeNull();
  });

  it('刪除：確認框寫明會失效的 token 數，確認後呼叫刪除', async () => {
    renderRoute(routes, '/service-account', MANAGER);
    await screen.findByText('CI 建置', undefined, { timeout: 5000 });
    const row = screen.getByText('CI 建置').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByTestId('service-account-delete-button'));
    const confirm = await screen.findByTestId('service-account-delete-confirm');
    expect(confirm).toHaveTextContent('2 把有效 token');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
    expect(deleteAccount.mock.calls[0]![0]).toMatchObject({ params: { serviceAccountId: 'sa1' } });
  });
});
