import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderRoute } from '@b2b-system/web-core/testing';
import { Outlet } from '@tanstack/react-router';
import { fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry, usePageAccess } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import {
  registerServiceAccountPagePermissions,
  Routes,
  SERVICE_ACCOUNT_CREATE_PAGE,
} from '../../..';
import serviceAccountZhTW from '../../../locales/zh_TW.json';

const { createAccount, fetchRoles } = vi.hoisted(() => ({
  createAccount: vi.fn(),
  fetchRoles: vi.fn(),
}));
vi.mock('@/apis/service-account/create-service-account/fetcher', () => ({
  fetchServiceAccountCreateMutation: createAccount,
}));
vi.mock('@/apis/role/get-role-list/fetcher', () => ({ fetchRoleListQuery: fetchRoles }));

const CREATOR = ['serviceAccount:read', 'serviceAccount:create'] as PermissionKey[];
const CREATOR_WITH_ROLES = [...CREATOR, 'role:read'] as PermissionKey[];

// 列表頁只留 Outlet；建立後導向的詳情只確認導覽，不渲染真的詳情頁
Routes.ServiceAccountListRoute.update({ component: Outlet });
Routes.ServiceAccountDetailRoute.update({
  component: () => <p data-testid="service-account-detail-stub" />,
});
const routes = [
  Routes.ServiceAccountListRoute.addChildren([
    Routes.ServiceAccountCreateRoute,
    Routes.ServiceAccountDetailRoute,
  ]),
];

beforeAll(() => initTestI18n(serviceAccountZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerServiceAccountPagePermissions();
  featureStore.setState({ resolved: true, statuses: new Map([['externalApi', 'ready']]) });
  createAccount.mockReset().mockResolvedValue({ id: 'sa1', name: 'CI 建置', roles: [] });
  fetchRoles.mockReset().mockResolvedValue({
    items: [
      {
        id: 'r1',
        slug: 'auditor',
        name: '稽核人員',
        description: null,
        isSystem: true,
        userCount: 0,
        permissionCount: 1,
        version: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    pagination: { offset: 0, limit: 200, total: 1 },
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  featureStore.setState({ resolved: true, statuses: new Map() });
  vi.restoreAllMocks();
});

describe('建立服務帳號的頁面權限（docs/architecture/06-external-api.md §9 T4）', () => {
  it('有 serviceAccount:read＋serviceAccount:create → 進得去，顯示建立對話框', async () => {
    usePermissionStore.setState({ permissions: new Set(CREATOR), hydrated: true });
    expect(renderHook(() => usePageAccess('/service-account/create')).result.current).toMatchObject(
      { page: SERVICE_ACCOUNT_CREATE_PAGE, gated: true, canAccess: true },
    );

    renderRoute(routes, '/service-account/create', CREATOR);
    expect(
      await screen.findByTestId('service-account-create-dialog', undefined, { timeout: 5000 }),
    ).toHaveTextContent('建立服務帳號');
    expect(screen.getByTestId('service-account-name-input')).toBeInTheDocument();
  });

  it('只有 serviceAccount:read → 直接貼 /service-account/create 是 403（列表照常進得去）', () => {
    usePermissionStore.setState({
      permissions: new Set(['serviceAccount:read'] as PermissionKey[]),
      hydrated: true,
    });
    expect(renderHook(() => usePageAccess('/service-account/create')).result.current).toMatchObject(
      { page: SERVICE_ACCOUNT_CREATE_PAGE, gated: true, canAccess: false },
    );
    expect(renderHook(() => usePageAccess('/service-account')).result.current).toMatchObject({
      gated: true,
      canAccess: true,
    });
  });

  it('權限未水合 → 還不能判斷（不閃現內容，也不閃 403）', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => usePageAccess('/service-account/create')).result.current).toMatchObject(
      { page: SERVICE_ACCOUNT_CREATE_PAGE, hydrated: false, gated: true },
    );
  });
});

describe('ServiceAccountCreatePage', () => {
  it('有 role:read → 顯示角色欄；選了角色送出後進入詳情建 token', async () => {
    const { router } = renderRoute(routes, '/service-account/create', CREATOR_WITH_ROLES);
    fireEvent.change(
      await screen.findByTestId('service-account-name-input', undefined, { timeout: 5000 }),
      { target: { value: ' CI 建置 ' } },
    );
    await waitFor(() => expect(fetchRoles).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('service-account-role-select'));
    fireEvent.click(await screen.findByRole('option', { name: /稽核人員/ }));
    fireEvent.click(screen.getByTestId('service-account-create-submit'));

    expect(await screen.findByTestId('service-account-detail-stub')).toBeInTheDocument();
    expect(createAccount.mock.calls[0]![0]).toMatchObject({
      params: { name: 'CI 建置', roleIds: ['r1'] },
    });
    expect(router.state.location.pathname).toBe('/service-account/sa1');
  });

  it('沒有 role:read → 不查角色、不顯示角色欄，只送名稱', async () => {
    renderRoute(routes, '/service-account/create', CREATOR);
    fireEvent.change(
      await screen.findByTestId('service-account-name-input', undefined, { timeout: 5000 }),
      { target: { value: 'CI 建置' } },
    );
    expect(screen.queryByTestId('service-account-role-select')).toBeNull();
    fireEvent.click(screen.getByTestId('service-account-create-submit'));

    await waitFor(() => expect(createAccount).toHaveBeenCalledTimes(1));
    expect(createAccount.mock.calls[0]![0]).toMatchObject({
      params: { name: 'CI 建置', roleIds: [] },
    });
    expect(fetchRoles).not.toHaveBeenCalled();
  });

  it('權限未水合 → 不閃現角色欄，也不先查角色', async () => {
    renderRoute(routes, '/service-account/create', 'unhydrated');
    await screen.findByTestId('service-account-create-dialog', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('service-account-role-select')).toBeNull();
    expect(fetchRoles).not.toHaveBeenCalled();
  });

  it('名稱空白 → 不能送出', async () => {
    renderRoute(routes, '/service-account/create', CREATOR);
    fireEvent.change(
      await screen.findByTestId('service-account-name-input', undefined, { timeout: 5000 }),
      { target: { value: '   ' } },
    );
    expect(screen.getByTestId('service-account-create-submit')).toBeDisabled();
  });
});
