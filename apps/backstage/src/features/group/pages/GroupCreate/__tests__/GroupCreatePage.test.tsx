import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderRoute } from '@b2b-system/web-core/testing';
import { Outlet } from '@tanstack/react-router';
import { fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry, usePageAccess } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { GROUP_CREATE_PAGE, registerGroupPagePermissions, Routes } from '../../..';
import groupZhTW from '../../../locales/zh_TW.json';

const { createGroup } = vi.hoisted(() => ({ createGroup: vi.fn() }));
vi.mock('@/apis/group/create-group/fetcher', () => ({ fetchGroupCreateMutation: createGroup }));

const CREATOR = ['group:read', 'group:create'] as PermissionKey[];

// 列表頁只留 Outlet；建立後導向的詳情只確認導覽，不渲染真的詳情頁
Routes.GroupListRoute.update({ component: Outlet });
Routes.GroupDetailRoute.update({ component: () => <p data-testid="group-detail-stub" /> });
const routes = [
  Routes.GroupListRoute.addChildren([Routes.GroupCreateRoute, Routes.GroupDetailRoute]),
];

beforeAll(() => initTestI18n(groupZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerGroupPagePermissions();
  featureStore.setState({ resolved: true, statuses: new Map([['group', 'ready']]) });
  createGroup.mockReset().mockResolvedValue({ id: 'g1', name: '美術' });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  featureStore.setState({ resolved: true, statuses: new Map() });
  vi.restoreAllMocks();
});

describe('建立群組的頁面權限（docs/architecture/iam/07-groups.md）', () => {
  it('有 group:read＋group:create → 進得去，顯示建立對話框', async () => {
    usePermissionStore.setState({ permissions: new Set(CREATOR), hydrated: true });
    expect(renderHook(() => usePageAccess('/group/create')).result.current).toMatchObject({
      page: GROUP_CREATE_PAGE,
      gated: true,
      canAccess: true,
    });

    renderRoute(routes, '/group/create', CREATOR);
    expect(
      await screen.findByTestId('group-create-dialog', undefined, { timeout: 5000 }),
    ).toHaveTextContent('建立群組');
    expect(screen.getByTestId('group-name-input')).toBeInTheDocument();
  });

  it('只有 group:read → 直接貼 /group/create 是 403（列表照常進得去）', () => {
    usePermissionStore.setState({
      permissions: new Set(['group:read'] as PermissionKey[]),
      hydrated: true,
    });
    expect(renderHook(() => usePageAccess('/group/create')).result.current).toMatchObject({
      page: GROUP_CREATE_PAGE,
      gated: true,
      canAccess: false,
    });
    expect(renderHook(() => usePageAccess('/group')).result.current).toMatchObject({
      gated: true,
      canAccess: true,
    });
  });

  it('權限未水合 → 還不能判斷（不閃現內容，也不閃 403）', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => usePageAccess('/group/create')).result.current).toMatchObject({
      page: GROUP_CREATE_PAGE,
      hydrated: false,
      gated: true,
    });
  });
});

describe('GroupCreatePage', () => {
  it('送出名稱與說明 → 建立後進入詳情加成員', async () => {
    const { router } = renderRoute(routes, '/group/create', CREATOR);
    fireEvent.change(await screen.findByTestId('group-name-input', undefined, { timeout: 5000 }), {
      target: { value: '美術' },
    });
    fireEvent.click(screen.getByTestId('group-create-submit'));

    expect(await screen.findByTestId('group-detail-stub')).toBeInTheDocument();
    expect(createGroup.mock.calls[0]![0]).toMatchObject({
      params: { name: '美術', description: undefined },
    });
    expect(router.state.location.pathname).toBe('/group/g1');
  });

  it('名稱空白 → 名稱欄標示錯誤，不送出', async () => {
    renderRoute(routes, '/group/create', CREATOR);
    await screen.findByTestId('group-name-input', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('group-create-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('group-name-input')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(createGroup).not.toHaveBeenCalled();
  });
});
