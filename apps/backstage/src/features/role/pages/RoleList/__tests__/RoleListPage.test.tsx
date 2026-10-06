import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerRolePagePermissions, Routes } from '../../..';
import roleZhTW from '../../../locales/zh_TW.json';

const { fetchRoles, deleteRole } = vi.hoisted(() => ({
  fetchRoles: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock('@/apis/role/get-role-list/fetcher', () => ({ fetchRoleListQuery: fetchRoles }));
vi.mock('@/apis/role/delete-role/fetcher', () => ({ fetchRoleDeleteMutation: deleteRole }));

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
});
