import { Outlet } from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/core/errors';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { renderRoute } from '@/test/renderRoute';

import { registerRolePagePermissions, Routes } from '../../..';

const { fetchRole, fetchRolePermissions, fetchRoleUsers, updateRole, duplicateRole } = vi.hoisted(
  () => ({
    fetchRole: vi.fn(),
    fetchRolePermissions: vi.fn(),
    fetchRoleUsers: vi.fn(),
    updateRole: vi.fn(),
    duplicateRole: vi.fn(),
  }),
);
vi.mock('@/apis/role/get-role-detail/fetcher', () => ({ fetchRoleDetailQuery: fetchRole }));
vi.mock('@/apis/role/get-role-permissions/fetcher', () => ({
  fetchRolePermissionsQuery: fetchRolePermissions,
}));
vi.mock('@/apis/role/get-role-users/fetcher', () => ({ fetchRoleUsersQuery: fetchRoleUsers }));
vi.mock('@/apis/role/update-role/fetcher', () => ({ fetchRoleUpdateMutation: updateRole }));
vi.mock('@/apis/role/duplicate-role/fetcher', () => ({
  fetchRoleDuplicateMutation: duplicateRole,
}));

const ROLE_ID = '22222222-2222-4222-8222-222222222222';
const ROLE = {
  id: ROLE_ID,
  slug: 'editor',
  name: 'Editor',
  description: null,
  isSystem: false,
  permissionCount: 0,
  userCount: 0,
  createdAt: '2026-09-30T00:00:00.000Z',
};
const MANAGER = ['role:read', 'role:update', 'role:create'] as PermissionKey[];

Routes.RoleListRoute.update({ component: Outlet });
const routes = [Routes.RoleListRoute.addChildren([Routes.RoleDetailRoute])];

beforeEach(() => {
  resetPagePermissionRegistry();
  registerRolePagePermissions();
  fetchRole.mockReset().mockResolvedValue(ROLE);
  fetchRolePermissions.mockReset().mockResolvedValue({ permissions: [] });
  fetchRoleUsers.mockReset().mockResolvedValue({ items: [] });
  updateRole.mockReset().mockResolvedValue(ROLE);
  duplicateRole.mockReset().mockResolvedValue({ ...ROLE, id: 'copy' });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('RoleDetailPage（docs/issues/04-user-experience.md UX-03、UX-04、UX-20、UX-21）', () => {
  it('改名撞名時顯示錯誤提示，編輯區與輸入保留', async () => {
    updateRole.mockRejectedValue(new AppError('ROLE_NAME_DUPLICATE', 409));
    renderRoute(routes, `/role/${ROLE_ID}`, MANAGER);

    fireEvent.click(await screen.findByTestId('role-edit-button'));
    const input = screen.getByTestId('role-name-edit-input');
    fireEvent.change(input, { target: { value: 'Admin' } });
    // 在欄位按 Enter 就送出（<form>）
    fireEvent.submit(screen.getByTestId('role-edit-form'));

    expect(await screen.findByTestId('toast')).toHaveAttribute('data-value', 'error');
    expect(screen.getByTestId('role-name-edit-input')).toHaveValue('Admin');
  });

  it('儲存成功才離開編輯狀態', async () => {
    renderRoute(routes, `/role/${ROLE_ID}`, MANAGER);

    fireEvent.click(await screen.findByTestId('role-edit-button'));
    fireEvent.change(screen.getByTestId('role-name-edit-input'), { target: { value: 'Writer' } });
    fireEvent.click(screen.getByTestId('role-save-button'));

    await waitFor(() => expect(screen.queryByTestId('role-edit-form')).not.toBeInTheDocument());
    expect(updateRole.mock.calls[0]![0]).toMatchObject({
      params: { roleId: ROLE_ID, body: { name: 'Writer' } },
    });
  });

  it('複製失敗時顯示錯誤提示', async () => {
    duplicateRole.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, `/role/${ROLE_ID}`, MANAGER);

    fireEvent.click(await screen.findByTestId('role-duplicate-button'));

    expect(await screen.findByTestId('toast')).toHaveAttribute('data-value', 'error');
  });

  it('角色不存在時說明原因並提供回到列表，不是空白對話框', async () => {
    fetchRole.mockRejectedValue(new AppError('ROLE_NOT_FOUND', 404));
    const { router } = renderRoute(routes, `/role/${ROLE_ID}`, MANAGER);

    expect(await screen.findByTestId('role-detail-error')).toBeInTheDocument();
    // 404 重試沒有意義，只提供返回
    expect(screen.queryByTestId('query-error-retry')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('role-detail-back'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/role'));
  });

  it('沒有 role:update／role:create → 不顯示編輯與複製', async () => {
    renderRoute(routes, `/role/${ROLE_ID}`, ['role:read'] as PermissionKey[]);

    expect(await screen.findByTestId('role-detail-dialog')).toBeInTheDocument();
    await screen.findByText('Editor');
    expect(screen.queryByTestId('role-edit-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('role-duplicate-button')).not.toBeInTheDocument();
  });

  it('權限未水合 → 不閃現編輯與複製', async () => {
    renderRoute(routes, `/role/${ROLE_ID}`, 'unhydrated');

    await screen.findByText('Editor');
    expect(screen.queryByTestId('role-edit-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('role-duplicate-button')).not.toBeInTheDocument();
  });
});
