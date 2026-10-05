import { installFlowDom } from '@b2b-system/ui/testing';
import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { Outlet } from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

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

const CREATOR = ['role:read', 'role:create', 'user:read', 'user:update'] as PermissionKey[];

/** 下拉選單或技能樹上的一個權限。 */
const byValue = (testId: string, key: string) =>
  screen
    .getAllByTestId(testId)
    .find((element) => element.getAttribute('data-value') === key) as HTMLElement;

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
      {
        key: 'user:update',
        resource: 'user',
        nameI18nKey: 'permission.user.update',
        includes: ['user:read'],
        requires: [],
      },
    ],
    groups: [
      {
        resource: 'user',
        nameI18nKey: 'permission.resource.user',
        keys: ['user:read', 'user:update'],
      },
    ],
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
      await screen.findByTestId('role-permission-select', undefined, { timeout: 5000 }),
    );
    fireEvent.click(byValue('role-permission-option', 'user:read'));
    fireEvent.keyDown(screen.getByTestId('select-search'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('role-create-cancel'));

    expect(await screen.findByTestId('unsaved-changes-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(screen.queryByTestId('role-create-dialog')).not.toBeInTheDocument());
  });

  it('技能樹預設收合；下拉選單與技能樹連動，只送出明確選的鍵', async () => {
    renderRoute(routes, '/role/create', CREATOR);

    fireEvent.change(await screen.findByTestId('role-name-input', undefined, { timeout: 5000 }), {
      target: { value: 'Editor' },
    });
    expect(screen.queryAllByTestId('role-permission-node')).toHaveLength(0);

    // 下拉選單勾上層 → 前置成為已包含（停用）
    fireEvent.click(await screen.findByTestId('role-permission-select'));
    fireEvent.click(byValue('role-permission-option', 'user:update'));
    expect(byValue('role-permission-option', 'user:update')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(byValue('role-permission-option', 'user:read')).toHaveAttribute('aria-disabled', 'true');
    expect(byValue('role-permission-option', 'user:read')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByTestId('select-search'), { key: 'Escape' });

    // 展開技能樹：同一份狀態，選過的權限顯示在說明面板
    fireEvent.click(screen.getByTestId('role-permission-tree-toggle'));
    await waitFor(() => expect(byValue('role-permission-node', 'user:update')).toBeInTheDocument());
    expect(byValue('role-permission-node', 'user:update')).toHaveAttribute(
      'data-state',
      'explicit',
    );
    expect(byValue('role-permission-node', 'user:read')).toHaveAttribute('data-state', 'implied');
    expect(screen.getByTestId('role-permission-detail')).toHaveTextContent('user:update');

    // 在技能樹上取消 → 下拉選單同步
    fireEvent.click(byValue('role-permission-node', 'user:update'));
    expect(screen.queryAllByTestId('select-tag')).toHaveLength(0);

    fireEvent.click(byValue('role-permission-node', 'user:read'));
    fireEvent.click(screen.getByTestId('role-create-submit'));
    await waitFor(() => expect(createRole).toHaveBeenCalledTimes(1));
    expect(createRole.mock.calls[0]![0]).toMatchObject({
      params: { permissionKeys: ['user:read'] },
    });
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
