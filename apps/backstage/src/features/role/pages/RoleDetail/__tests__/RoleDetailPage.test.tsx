import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { Outlet } from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerRolePagePermissions, Routes } from '../../..';
import roleZhTW from '../../../locales/zh_TW.json';

const {
  fetchRole,
  fetchRolePermissions,
  fetchRoleUsers,
  updateRole,
  duplicateRole,
  fetchGroups,
  fetchPermissionList,
} = vi.hoisted(() => ({
  fetchGroups: vi.fn(),
  fetchRole: vi.fn(),
  fetchRolePermissions: vi.fn(),
  fetchRoleUsers: vi.fn(),
  updateRole: vi.fn(),
  duplicateRole: vi.fn(),
  fetchPermissionList: vi.fn(),
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
vi.mock('@/apis/permission/get-permission-list/fetcher', () => ({
  fetchPermissionListQuery: fetchPermissionList,
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
const routes = [
  Routes.RoleListRoute.addChildren([
    Routes.RoleDetailRoute.addChildren([Routes.RoleDetailPermissionRoute]),
  ]),
];

beforeAll(() => initTestI18n(roleZhTW));

afterEach(() => resetFeatureStore());

beforeEach(() => {
  // 群組是可啟用的 feature（docs/architecture/iam/07-groups.md §8）：預設已啟用
  featureStore.setState({ resolved: true, statuses: new Map([['group', 'ready']]) });
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
  fetchPermissionList.mockReset().mockResolvedValue({ items: [], groups: [] });
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
    expect(screen.queryByTestId('role-manage-permission-button')).not.toBeInTheDocument();
  });

  it('有 group:read → 持有者分「直接持有」與「經由群組」，以 roleId 查群組（docs/architecture/iam/01-model.md §9 G4）', async () => {
    renderRoute(routes, `/role/${ROLE_ID}`, [
      'role:read',
      'user:read',
      'group:read',
    ] as PermissionKey[]);
    const groups = await screen.findAllByTestId('role-holder-group');
    expect(groups.map((group) => group.getAttribute('data-value'))).toEqual(['g1']);
    expect(fetchGroups.mock.calls[0]![0].params).toMatchObject({ roleId: ROLE_ID });
  });

  it('持有者裡的服務帳號標示「服務帳號」，不顯示 email（docs/architecture/05-tenancy.md §15.2 D4）', async () => {
    fetchRoleUsers.mockResolvedValue({
      items: [
        { id: 'u1', kind: 'human', email: 'a@example.com', displayName: 'Alice', status: 'active' },
        { id: 's1', kind: 'service', email: 's1@svc', displayName: 'CI bot', status: 'active' },
      ],
    });
    renderRoute(routes, `/role/${ROLE_ID}`, ['role:read', 'user:read'] as PermissionKey[]);
    const rows = await screen.findAllByTestId('role-holder-user');
    expect(rows.map((row) => row.textContent)).toEqual(['Alicea@example.com', 'CI bot服務帳號']);
  });

  it('沒有 group:read → 不查也不顯示經由群組', async () => {
    renderRoute(routes, `/role/${ROLE_ID}`, ['role:read', 'user:read'] as PermissionKey[]);
    await screen.findByText('Editor');
    expect(screen.queryByTestId('role-holder-groups')).not.toBeInTheDocument();
    expect(fetchGroups).not.toHaveBeenCalled();
  });

  it('租戶沒有啟用 group → 有 group:read 也不查、不顯示經由群組', async () => {
    featureStore.setState({ resolved: true, statuses: new Map([['group', 'disabled']]) });
    renderRoute(routes, `/role/${ROLE_ID}`, [
      'role:read',
      'user:read',
      'group:read',
    ] as PermissionKey[]);
    await screen.findByText('Editor');
    expect(screen.queryByTestId('role-holder-groups')).not.toBeInTheDocument();
    expect(fetchGroups).not.toHaveBeenCalled();
  });

  describe('權限子頁的入口（docs/architecture/frontend/06-permission.md §7）', () => {
    const VIEWER = ['role:read', 'permission:read'] as PermissionKey[];
    const GRANTER = [...VIEWER, 'role:grantPermission'] as PermissionKey[];

    it.each([
      ['admin', 'admin'],
      ['member', 'member'],
    ])('系統角色 %s ＋ role:grantPermission → 顯示「管理權限」', async (_, slug) => {
      fetchRole.mockResolvedValue({ ...ROLE, slug, name: slug, isSystem: true });
      renderRoute(routes, `/role/${ROLE_ID}`, GRANTER);
      expect(await screen.findByTestId('role-manage-permission-button')).toHaveTextContent(
        '管理權限',
      );
    });

    it('super-admin → 不顯示入口', async () => {
      fetchRole.mockResolvedValue({ ...ROLE, slug: 'super-admin', name: 'Root', isSystem: true });
      renderRoute(routes, `/role/${ROLE_ID}`, GRANTER);
      await screen.findByText('Root');
      expect(screen.queryByTestId('role-manage-permission-button')).not.toBeInTheDocument();
    });

    it('只有 role:read ＋ permission:read → 顯示「檢視權限」，進去是唯讀', async () => {
      renderRoute(routes, `/role/${ROLE_ID}`, VIEWER);
      const entry = await screen.findByTestId('role-manage-permission-button');
      expect(entry).toHaveTextContent('檢視權限');

      fireEvent.click(entry);
      expect(await screen.findByTestId('role-permission-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('role-permission-save')).toBeDisabled();
    });

    it('只有 role:update、沒有 permission:read → 不顯示入口', async () => {
      renderRoute(routes, `/role/${ROLE_ID}`, ['role:read', 'role:update'] as PermissionKey[]);
      await screen.findByText('Editor');
      expect(screen.queryByTestId('role-manage-permission-button')).not.toBeInTheDocument();
    });
  });
});
