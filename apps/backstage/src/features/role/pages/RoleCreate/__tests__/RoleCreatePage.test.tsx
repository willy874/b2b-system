import { Outlet } from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/core/errors';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { installFlowDom } from '@/test/flowDom';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { registerRolePagePermissions, Routes } from '../../..';
import roleZhTW from '../../../locales/zh_TW.json';

const { createRole, fetchPermissionList } = vi.hoisted(() => ({
  createRole: vi.fn(),
  fetchPermissionList: vi.fn(),
}));
vi.mock('@/apis/role/create-role/fetcher', () => ({ fetchRoleCreateMutation: createRole }));
vi.mock('@/apis/permission/get-permission-list/fetcher', () => ({
  fetchPermissionListQuery: fetchPermissionList,
}));

const CREATOR = ['role:read', 'role:create', 'user:read'] as PermissionKey[];

Routes.RoleListRoute.update({ component: Outlet });
const routes = [Routes.RoleListRoute.addChildren([Routes.RoleCreateRoute])];

beforeAll(() => initTestI18n(roleZhTW));

beforeAll(installFlowDom);
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetPagePermissionRegistry();
  registerRolePagePermissions();
  createRole.mockReset().mockResolvedValue({ id: 'r1', name: 'Editor' });
  fetchPermissionList.mockReset().mockResolvedValue({
    items: [
      {
        key: 'user:read',
        resource: 'user',
        nameI18nKey: 'permission.user.read',
        includes: [],
        requires: [],
      },
    ],
    groups: [{ resource: 'user', nameI18nKey: 'permission.resource.user', keys: ['user:read'] }],
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('RoleCreatePage', () => {
  it('名稱重複時錯誤顯示在名稱欄並聚焦', async () => {
    createRole.mockRejectedValue(new AppError('ROLE_NAME_DUPLICATE', 409));
    renderRoute(routes, '/role/create', CREATOR);

    const name = await screen.findByTestId('role-name-input', undefined, { timeout: 5000 });
    fireEvent.change(name, { target: { value: 'Admin' } });
    fireEvent.click(screen.getByTestId('role-create-submit'));

    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveAccessibleDescription('角色名稱重複。');
    await waitFor(() => expect(name).toHaveFocus());
  });

  it('勾了權限後點取消會先確認；選放棄才關閉', async () => {
    renderRoute(routes, '/role/create', CREATOR);

    fireEvent.click(
      await screen.findByTestId('role-permission-node', undefined, { timeout: 5000 }),
    );
    fireEvent.click(screen.getByTestId('role-create-cancel'));

    expect(await screen.findByTestId('unsaved-changes-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(screen.queryByTestId('role-create-dialog')).not.toBeInTheDocument());
  });

  it('建立成功後直接關閉，不跳放棄確認', async () => {
    renderRoute(routes, '/role/create', CREATOR);

    fireEvent.change(await screen.findByTestId('role-name-input', undefined, { timeout: 5000 }), {
      target: { value: 'Editor' },
    });
    fireEvent.click(screen.getByTestId('role-create-submit'));

    await waitFor(() => expect(screen.queryByTestId('role-create-dialog')).not.toBeInTheDocument());
    expect(screen.queryByTestId('unsaved-changes-confirm')).not.toBeInTheDocument();
  });
});
