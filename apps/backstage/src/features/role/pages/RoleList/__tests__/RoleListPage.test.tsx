import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerRolePagePermissions, Routes } from '../../..';
import roleZhTW from '../../../locales/zh_TW.json';
import type * as adapter from '../adapter';

const { fetchRoles, deleteRole, toRoleRowVM, fetchRole } = vi.hoisted(() => ({
  fetchRole: vi.fn(),
  fetchRoles: vi.fn(),
  deleteRole: vi.fn(),
  toRoleRowVM: vi.fn(),
}));
vi.mock('@/apis/role/get-role-list/fetcher', () => ({ fetchRoleListQuery: fetchRoles }));
vi.mock('@/apis/role/get-role-detail/fetcher', () => ({ fetchRoleDetailQuery: fetchRole }));
vi.mock('@/apis/role/delete-role/fetcher', () => ({ fetchRoleDeleteMutation: deleteRole }));
// 計算 adapter 被呼叫幾次：列是否在與資料、權限無關的重繪時重建
vi.mock('../adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof adapter>();
  toRoleRowVM.mockImplementation(actual.toRoleRowVM);
  return { ...actual, toRoleRowVM };
});

const role = (id: string, name: string, userCount: number) => ({
  id,
  slug: name.toLowerCase(),
  name,
  description: null,
  isSystem: false,
  permissionCount: 1,
  userCount,
  createdAt: '2026-09-30T00:00:00.000Z',
});
const MANAGER = ['role:read', 'role:delete'] as PermissionKey[];
const routes = [Routes.RoleListRoute];

beforeAll(() => initTestI18n(roleZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerRolePagePermissions();
  fetchRoles.mockReset().mockResolvedValue({
    items: [role('r1', 'Editor', 3), role('r2', 'Viewer', 0)],
    pagination: { total: 2 },
  });
  deleteRole.mockReset().mockResolvedValue(undefined);
  // 詳情在這些測試裡不重要：維持載入中
  fetchRole.mockReset().mockReturnValue(new Promise(() => {}));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

function deleteButtonOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr') as HTMLElement;
  return within(row).getByTestId('role-delete-button');
}

describe('RoleListPage', () => {
  it('刪除有人持有的角色：確認框寫明人數，確認即強制刪除', async () => {
    renderRoute(routes, '/role', MANAGER);
    await screen.findByText('Editor', undefined, { timeout: 5000 });

    fireEvent.click(deleteButtonOf('Editor'));
    const confirm = await screen.findByTestId('role-delete-confirm');
    expect(confirm).toHaveTextContent('目前有 3 位使用者持有');
    expect(within(confirm).getByTestId('alert-dialog-confirm')).toHaveTextContent(
      '仍要刪除（3 人將失去此角色）',
    );
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));

    await waitFor(() => expect(deleteRole).toHaveBeenCalledTimes(1));
    expect(deleteRole.mock.calls[0]![0]).toMatchObject({ params: { roleId: 'r1', force: true } });
  });

  it('沒有人持有時維持一般的刪除確認', async () => {
    renderRoute(routes, '/role', MANAGER);
    await screen.findByText('Viewer', undefined, { timeout: 5000 });

    fireEvent.click(deleteButtonOf('Viewer'));
    const confirm = await screen.findByTestId('role-delete-confirm');
    expect(confirm).toHaveTextContent('保留期限內可以還原');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));

    await waitFor(() => expect(deleteRole).toHaveBeenCalledTimes(1));
    expect(deleteRole.mock.calls[0]![0]).toMatchObject({ params: { roleId: 'r2', force: false } });
  });

  it('列表沒算到的持有者（經由群組持有）：刪除回 ROLE_IN_USE → 確認框改成強制刪除，再確認才帶 force', async () => {
    deleteRole.mockRejectedValueOnce(new AppError('ROLE_IN_USE', 409, { userCount: 2 }));
    renderRoute(routes, '/role', MANAGER);
    await screen.findByText('Viewer', undefined, { timeout: 5000 });

    fireEvent.click(deleteButtonOf('Viewer'));
    const confirm = await screen.findByTestId('role-delete-confirm');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    await waitFor(() =>
      expect(within(confirm).getByTestId('alert-dialog-confirm')).toHaveTextContent(
        '仍要刪除（2 人將失去此角色）',
      ),
    );
    expect(deleteRole.mock.calls[0]![0]).toMatchObject({ params: { roleId: 'r2', force: false } });

    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(deleteRole).toHaveBeenCalledTimes(2));
    expect(deleteRole.mock.calls[1]![0]).toMatchObject({ params: { roleId: 'r2', force: true } });
  });

  it('沒有 role:delete → 不顯示刪除', async () => {
    renderRoute(routes, '/role', ['role:read'] as PermissionKey[]);
    await screen.findByText('Editor', undefined, { timeout: 5000 });

    expect(screen.queryByTestId('role-delete-button')).not.toBeInTheDocument();
  });

  it('權限未水合 → 不閃現刪除', async () => {
    renderRoute(routes, '/role', 'unhydrated');
    await screen.findByText('Editor', undefined, { timeout: 5000 });

    expect(screen.queryByTestId('role-delete-button')).not.toBeInTheDocument();
  });

  it('與資料、權限無關的重繪（打開刪除確認框）不重建列（docs/architecture/frontend/06-permission.md）', async () => {
    renderRoute(routes, '/role', MANAGER);
    await screen.findByText('Viewer', undefined, { timeout: 5000 });
    const built = toRoleRowVM.mock.calls.length;

    fireEvent.click(deleteButtonOf('Viewer'));
    await screen.findByTestId('role-delete-confirm');

    expect(toRoleRowVM.mock.calls.length).toBe(built);
  });
});

describe('RoleListPage 的匯出、匯入入口（docs/architecture/backend/22-data-transfer.md §12.1）', () => {
  beforeEach(() => {
    featureStore.setState({ resolved: true, statuses: new Map([['dataTransfer', 'ready']]) });
  });
  afterEach(() => {
    featureStore.setState({ resolved: true, statuses: new Map() });
  });

  it('有 role:export、role:update → 顯示「匯出」「匯入」', async () => {
    renderRoute(routes, '/role', ['role:read', 'role:update', 'role:export'] as PermissionKey[]);
    await screen.findByText('Editor', undefined, { timeout: 5000 });
    expect(screen.getByTestId('role-export-button')).toBeInTheDocument();
    expect(screen.getByTestId('role-import-button')).toBeInTheDocument();
  });

  it('只有 role:read → 兩個入口都不顯示；租戶沒有啟用 dataTransfer 時也不顯示', async () => {
    renderRoute(routes, '/role', ['role:read'] as PermissionKey[]);
    await screen.findByText('Editor', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('role-export-button')).toBeNull();
    expect(screen.queryByTestId('role-import-button')).toBeNull();
  });

  it('租戶沒有啟用 dataTransfer → 有權限也不顯示', async () => {
    featureStore.setState({ resolved: true, statuses: new Map() });
    renderRoute(routes, '/role', ['role:read', 'role:update', 'role:export'] as PermissionKey[]);
    await screen.findByText('Editor', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('role-export-button')).toBeNull();
    expect(screen.queryByTestId('role-import-button')).toBeNull();
  });
});

describe('RoleListPage 的其他操作', () => {
  it('刪除失敗（不是 ROLE_IN_USE）→ 確認框留著，不改成強制刪除', async () => {
    deleteRole.mockRejectedValue(new AppError('ROLE_NOT_FOUND', 404));
    renderRoute(routes, '/role', MANAGER);
    await screen.findByText('Viewer', undefined, { timeout: 5000 });
    fireEvent.click(deleteButtonOf('Viewer'));
    const confirm = await screen.findByTestId('role-delete-confirm');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(deleteRole).toHaveBeenCalledTimes(1));
    expect(deleteRole.mock.calls[0]![0]).toMatchObject({ params: { roleId: 'r2', force: false } });
    expect(screen.getByTestId('role-delete-confirm')).toBeInTheDocument();
    expect(within(confirm).getByTestId('alert-dialog-confirm')).toHaveTextContent('刪除');
  });

  it('有 role:create → 顯示建立角色', async () => {
    renderRoute(routes, '/role', [...MANAGER, 'role:create'] as PermissionKey[]);
    expect(
      await screen.findByTestId('role-create-button', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('沒有 role:create → 不顯示建立角色', async () => {
    renderRoute(routes, '/role', MANAGER);
    await screen.findByText('Viewer', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('role-create-button')).toBeNull();
  });

  it('權限未水合 → 不閃現建立角色', async () => {
    renderRoute(routes, '/role', 'unhydrated');
    await waitFor(() => expect(fetchRoles).toHaveBeenCalled());
    expect(screen.queryByTestId('role-create-button')).toBeNull();
  });

  it('雙擊一列 → 打開那個角色的詳情', async () => {
    const { router } = renderRoute(
      [Routes.RoleListRoute.addChildren([Routes.RoleDetailRoute])],
      '/role',
      MANAGER,
    );
    const name = await screen.findByText('Editor', undefined, { timeout: 5000 });
    fireEvent.doubleClick(name.closest('tr')!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/role/r1'));
  });

  it('換頁：以新的 offset 查詢', async () => {
    fetchRoles.mockResolvedValue({ items: [role('r1', 'Editor', 0)], pagination: { total: 45 } });
    renderRoute(routes, '/role', MANAGER);
    // 資料回來前分頁列的總數是 0、下一頁停用
    await screen.findByText('Editor', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('pagination-next'));
    await waitFor(() =>
      expect(fetchRoles).toHaveBeenLastCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ offset: 20 }) }),
      ),
    );
  });
});
