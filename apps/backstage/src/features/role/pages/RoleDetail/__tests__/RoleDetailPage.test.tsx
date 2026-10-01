import { Outlet } from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/core/errors';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { renderRoute } from '@/test/renderRoute';

import { registerRolePagePermissions, Routes } from '../../..';

const { fetchRole, fetchRolePermissions, fetchRoleUsers, updateRole, duplicateRole, fetchGroups } =
  vi.hoisted(() => ({
    fetchGroups: vi.fn(),
    fetchRole: vi.fn(),
    fetchRolePermissions: vi.fn(),
    fetchRoleUsers: vi.fn(),
    updateRole: vi.fn(),
    duplicateRole: vi.fn(),
  }));
vi.mock('@/apis/group/get-group-list/fetcher', () => ({ fetchGroupListQuery: fetchGroups }));
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
  version: 5,
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
  fetchGroups.mockReset().mockResolvedValue({
    items: [
      { id: 'g1', name: '美術', description: null, memberCount: 3, roleCount: 1, version: 1 },
    ],
    pagination: { total: 1 },
  });
  updateRole.mockReset().mockResolvedValue(ROLE);
  duplicateRole.mockReset().mockResolvedValue({ ...ROLE, id: 'copy' });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('RoleDetailPage', () => {
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

  it('送出帶開始編輯時的 version（樂觀鎖）', async () => {
    renderRoute(routes, `/role/${ROLE_ID}`, MANAGER);

    fireEvent.click(await screen.findByTestId('role-edit-button'));
    fireEvent.change(screen.getByTestId('role-name-edit-input'), { target: { value: 'Writer' } });
    fireEvent.submit(screen.getByTestId('role-edit-form'));

    await waitFor(() => expect(updateRole).toHaveBeenCalledTimes(1));
    expect(updateRole.mock.calls[0]![0].params.body).toEqual({
      name: 'Writer',
      description: '',
      version: 5,
    });
  });

  it('別人已改過 → 表單上說明、不彈 toast；重新載入後換成最新的內容與 version', async () => {
    updateRole.mockRejectedValueOnce(new AppError('ROLE_VERSION_CONFLICT', 409, { current: 6 }));
    renderRoute(routes, `/role/${ROLE_ID}`, MANAGER);

    fireEvent.click(await screen.findByTestId('role-edit-button'));
    fireEvent.change(screen.getByTestId('role-name-edit-input'), { target: { value: 'Mine' } });
    fireEvent.submit(screen.getByTestId('role-edit-form'));

    expect(await screen.findByTestId('version-conflict-alert')).toBeInTheDocument();
    expect(screen.getByTestId('role-name-edit-input')).toHaveValue('Mine');
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();

    fetchRole.mockResolvedValue({ ...ROLE, name: 'Theirs', version: 6 });
    fireEvent.click(screen.getByTestId('version-conflict-reload'));
    await waitFor(() => expect(screen.getByTestId('role-name-edit-input')).toHaveValue('Theirs'));
    expect(screen.queryByTestId('version-conflict-alert')).not.toBeInTheDocument();

    fireEvent.submit(screen.getByTestId('role-edit-form'));
    await waitFor(() => expect(updateRole).toHaveBeenCalledTimes(2));
    expect(updateRole.mock.calls[1]![0].params.body).toMatchObject({ version: 6 });
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

  it('有 group:read → 持有者分「直接持有」與「經由群組」，以 roleId 查群組（ADR-0024 G4）', async () => {
    renderRoute(routes, `/role/${ROLE_ID}`, [
      'role:read',
      'user:read',
      'group:read',
    ] as PermissionKey[]);
    const groups = await screen.findAllByTestId('role-holder-group');
    expect(groups.map((group) => group.getAttribute('data-value'))).toEqual(['g1']);
    expect(fetchGroups.mock.calls[0]![0].params).toMatchObject({ roleId: ROLE_ID });
  });

  it('沒有 group:read → 不查也不顯示經由群組', async () => {
    renderRoute(routes, `/role/${ROLE_ID}`, ['role:read', 'user:read'] as PermissionKey[]);
    await screen.findByText('Editor');
    expect(screen.queryByTestId('role-holder-groups')).not.toBeInTheDocument();
    expect(fetchGroups).not.toHaveBeenCalled();
  });
});
