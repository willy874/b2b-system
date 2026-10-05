import { AppError } from '@b2b-system/web-core/errors';
import { RootRoute } from '@b2b-system/web-core/router';
import { renderRoute } from '@b2b-system/web-core/testing';
import { createRoute } from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { useUserDeleteMutation } from '../../hooks/useUserMutations';
import userZhTW from '../../locales/zh_TW.json';
import { UserDetailRoute, UserListRoute } from '../../routes';
import { UserRestoreAction } from '../UserRestoreAction';

const { restoreUser, deleteUser } = vi.hoisted(() => ({
  restoreUser: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock('@/apis/user/restore-user/fetcher', () => ({ fetchUserRestoreMutation: restoreUser }));
vi.mock('@/apis/user/delete-user/fetcher', () => ({ fetchUserDeleteMutation: deleteUser }));

const DELETED_ID = '77777777-7777-4777-8777-777777777777';
const CONFLICTING_ID = '88888888-8888-4888-8888-888888888888';
const ITEM = {
  id: DELETED_ID,
  type: 'user' as const,
  name: 'Deleted Person',
  description: 'dup@acme.test',
  deletedAt: '2026-09-30T00:00:00.000Z',
  deletedBy: null,
  purgeAt: '2026-10-30T00:00:00.000Z',
};
const PERMISSIONS = ['user:read', 'user:delete'] as PermissionKey[];

/** 回收桶頁之外單獨渲染還原按鈕；「查看該帳號」導向使用者詳情的路由。 */
const RestoreRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/restore',
  component: () => <UserRestoreAction item={ITEM} />,
});

function DeleteButton() {
  const remove = useUserDeleteMutation();
  return (
    <button type="button" onClick={() => remove.mutate({ params: { userId: DELETED_ID } })}>
      delete
    </button>
  );
}
const DeleteRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/delete',
  component: DeleteButton,
});

UserDetailRoute.update({ component: () => <p data-testid="user-detail-stub" /> });
const routes = [RestoreRoute, DeleteRoute, UserListRoute.addChildren([UserDetailRoute])];

beforeAll(() => initTestI18n(userZhTW));

beforeEach(() => {
  // 復原按鈕只在租戶啟用回收桶時出現（docs/architecture/05-tenancy.md §12.2 D3）
  resetFeatureStore();
  featureStore.setState({ resolved: true, statuses: new Map([['trash', 'ready']]) });
  restoreUser.mockReset().mockResolvedValue({
    id: DELETED_ID,
    displayName: 'Deleted Person',
    roles: [],
  });
  deleteUser.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('使用者的還原（docs/architecture/backend/14-revisions.md §9.2 D6）', () => {
  it('按下還原 → 呼叫 POST /users/:id/restore 並提示成功', async () => {
    renderRoute(routes, '/restore', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('user-restore'));
    await waitFor(() => expect(restoreUser).toHaveBeenCalledTimes(1));
    expect(restoreUser.mock.calls[0]![0].params).toEqual({ userId: DELETED_ID });
    expect(await screen.findByText('已還原「Deleted Person」。')).toBeInTheDocument();
  });

  it('email 已被別的帳號使用（409）→ 提示附「查看該帳號」，按下導向佔用的帳號', async () => {
    restoreUser.mockRejectedValue(
      new AppError('USER_EMAIL_DUPLICATE', 409, {
        field: 'email',
        value: 'dup@acme.test',
        conflictingUserId: CONFLICTING_ID,
      }),
    );
    const { router } = renderRoute(routes, '/restore', PERMISSIONS);
    fireEvent.click(await screen.findByTestId('user-restore'));

    fireEvent.click(await screen.findByRole('button', { name: '查看該帳號' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/user/${CONFLICTING_ID}`));
  });

  it('刪除成功的提示附「復原」，按下就還原剛刪除的人', async () => {
    renderRoute(routes, '/delete', PERMISSIONS);
    fireEvent.click(await screen.findByRole('button', { name: 'delete' }));

    fireEvent.click(await screen.findByRole('button', { name: '復原' }));
    await waitFor(() => expect(restoreUser).toHaveBeenCalledTimes(1));
    expect(restoreUser.mock.calls[0]![0].params).toEqual({ userId: DELETED_ID });
  });
});
