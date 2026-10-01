import { createRoute } from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/core/errors';
import { featureStore, resetFeatureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { RootRoute } from '@/core/router';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { useRoleDeleteMutation } from '../../hooks/useRoleMutations';
import roleZhTW from '../../locales/zh_TW.json';
import { RoleDetailRoute, RoleListRoute } from '../../routes';
import { RoleRestoreAction } from '../RoleRestoreAction';

const { restoreRole, deleteRole } = vi.hoisted(() => ({
  restoreRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock('@/apis/role/restore-role/fetcher', () => ({ fetchRoleRestoreMutation: restoreRole }));
vi.mock('@/apis/role/delete-role/fetcher', () => ({ fetchRoleDeleteMutation: deleteRole }));

const DELETED_ID = '77777777-7777-4777-8777-777777777777';
const CONFLICTING_ID = '88888888-8888-4888-8888-888888888888';
const ITEM = {
  id: DELETED_ID,
  type: 'role' as const,
  name: '內容編輯',
  description: '可以編輯內容',
  deletedAt: '2026-09-30T00:00:00.000Z',
  deletedBy: null,
  purgeAt: '2026-10-30T00:00:00.000Z',
};
const PERMISSIONS = ['role:read', 'role:delete'] as PermissionKey[];

/** 回收桶頁之外單獨渲染還原按鈕；「查看該角色」導向角色詳情的路由。 */
const RestoreRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/restore',
  component: () => <RoleRestoreAction item={ITEM} />,
});

function DeleteButton() {
  const remove = useRoleDeleteMutation();
  return (
    <button type="button" onClick={() => remove.mutate({ params: { roleId: DELETED_ID } })}>
      delete
    </button>
  );
}
const DeleteRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/delete',
  component: DeleteButton,
});

RoleDetailRoute.update({ component: () => <p data-testid="role-detail-stub" /> });
const routes = [RestoreRoute, DeleteRoute, RoleListRoute.addChildren([RoleDetailRoute])];

function restored(holdersRestored: number) {
  return { id: DELETED_ID, name: '內容編輯', holdersRestored };
}

beforeAll(() => initTestI18n(roleZhTW));

beforeEach(() => {
  // 復原按鈕只在租戶啟用回收桶時出現（docs/adr/0029-toggleable-platform-features.md D3）
  resetFeatureStore();
  featureStore.setState({ resolved: true, statuses: new Map([['trash', 'ready']]) });
  restoreRole.mockReset().mockResolvedValue(restored(0));
  deleteRole.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('角色的還原（ADR-0025 R3）', () => {
  it('按下還原 → 呼叫 POST /roles/:id/restore 並提示成功', async () => {
    renderRoute(routes, '/restore', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('role-restore'));
    await waitFor(() => expect(restoreRole).toHaveBeenCalledTimes(1));
    expect(restoreRole.mock.calls[0]![0].params).toEqual({ roleId: DELETED_ID });
    expect(await screen.findByText('已還原「內容編輯」。')).toBeInTheDocument();
  });

  it('原本的持有者一併恢復時，提示帶人數', async () => {
    restoreRole.mockResolvedValue(restored(3));
    renderRoute(routes, '/restore', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('role-restore'));
    expect(
      await screen.findByText('已還原「內容編輯」，3 位原本的持有者一併恢復。'),
    ).toBeInTheDocument();
  });

  it('名稱已被別的角色使用（409）→ 提示附「查看該角色」，按下導向佔用的角色', async () => {
    restoreRole.mockRejectedValue(
      new AppError('ROLE_NAME_DUPLICATE', 409, {
        field: 'name',
        value: '內容編輯',
        conflictingRoleId: CONFLICTING_ID,
      }),
    );
    const { router } = renderRoute(routes, '/restore', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('role-restore'));

    fireEvent.click(await screen.findByRole('button', { name: '查看該角色' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/role/${CONFLICTING_ID}`));
  });

  it('角色帶了自己沒有的權限（403 AUTHZ_ESCALATION）→ 說明無法還原的原因', async () => {
    restoreRole.mockRejectedValue(
      new AppError('AUTHZ_ESCALATION', 403, { missing: ['auditLog:read'] }),
    );
    renderRoute(routes, '/restore', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('role-restore'));
    expect(await screen.findByText('這個角色帶有你未持有的權限，無法還原。')).toBeInTheDocument();
  });

  it('刪除成功的提示附「復原」，按下就還原剛刪除的角色', async () => {
    renderRoute(routes, '/delete', PERMISSIONS);
    fireEvent.click(await screen.findByRole('button', { name: 'delete' }));

    fireEvent.click(await screen.findByRole('button', { name: '復原' }));
    await waitFor(() => expect(restoreRole).toHaveBeenCalledTimes(1));
    expect(restoreRole.mock.calls[0]![0].params).toEqual({ roleId: DELETED_ID });
  });

  it('租戶沒有啟用回收桶 → 刪除成功的提示沒有「復原」（docs/adr/0029-toggleable-platform-features.md D3）', async () => {
    featureStore.setState({ statuses: new Map([['trash', 'disabled']]) });
    renderRoute(routes, '/delete', PERMISSIONS);
    fireEvent.click(await screen.findByRole('button', { name: 'delete' }));

    expect(await screen.findByText('角色已刪除。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });
});
