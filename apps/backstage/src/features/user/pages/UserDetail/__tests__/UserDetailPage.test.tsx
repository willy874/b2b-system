import { Outlet } from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/core/errors';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { registerUserPagePermissions, Routes } from '../../..';
import userZhTW from '../../../locales/zh_TW.json';

const { fetchUser, fetchProfile, updateUser, unlockUser, fetchGroups } = vi.hoisted(() => ({
  fetchGroups: vi.fn(),
  fetchUser: vi.fn(),
  fetchProfile: vi.fn(),
  updateUser: vi.fn(),
  unlockUser: vi.fn(),
}));
vi.mock('@/apis/user/get-user-detail/fetcher', () => ({ fetchUserDetailQuery: fetchUser }));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@/apis/user/update-user/fetcher', () => ({ fetchUserUpdateMutation: updateUser }));
vi.mock('@/apis/user/unlock-user/fetcher', () => ({ fetchUserUnlockMutation: unlockUser }));
vi.mock('@/apis/group/get-group-list/fetcher', () => ({ fetchGroupListQuery: fetchGroups }));

const USER_ID = '44444444-4444-4444-8444-444444444444';
const PATH = `/user/${USER_ID}`;
const base = {
  id: USER_ID,
  email: 'p@acme.test',
  username: null,
  displayName: 'Person',
  roles: [],
  lastLoginAt: null,
  version: 3,
  createdAt: '2026-09-30T00:00:00.000Z',
};
const EDITOR = ['user:read', 'user:update'] as PermissionKey[];

Routes.UserListRoute.update({ component: Outlet });
const routes = [Routes.UserListRoute.addChildren([Routes.UserDetailRoute])];

beforeAll(() => initTestI18n(userZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerUserPagePermissions();
  fetchUser.mockReset().mockResolvedValue({ ...base, status: 'active' });
  fetchProfile.mockReset().mockResolvedValue({ user: { id: 'me' }, permissions: [] });
  updateUser.mockReset().mockImplementation(async ({ params }) => ({ ...base, ...params.body }));
  unlockUser.mockReset().mockResolvedValue({ ...base, status: 'active' });
  fetchGroups.mockReset().mockResolvedValue({
    items: [
      { id: 'g-art', name: '美術', memberCount: 1, roleCount: 1, version: 1, membership: 'nested' },
      {
        id: 'g-design',
        name: '角色設計',
        memberCount: 1,
        roleCount: 0,
        version: 1,
        membership: 'direct',
      },
    ],
    pagination: { total: 2 },
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

const conflict = () => new AppError('USER_VERSION_CONFLICT', 409, { current: 4 });

async function startEditing() {
  fireEvent.click(await screen.findByTestId('user-edit-button', undefined, { timeout: 5000 }));
  return screen.getByTestId('user-display-name-edit-input');
}

describe('UserDetailPage', () => {
  it('鎖定的使用者只改顯示名稱：只送出名稱，不會順便解鎖', async () => {
    fetchUser.mockResolvedValue({ ...base, status: 'locked' });
    renderRoute(routes, PATH, EDITOR);

    const input = await startEditing();
    expect(screen.queryByTestId('user-status-select')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.submit(screen.getByTestId('user-edit-form'));

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser.mock.calls[0]![0].params.body).toEqual({
      displayName: 'Renamed',
      version: 3,
    });
  });

  it('鎖定的使用者另有明確的「解鎖」按鈕', async () => {
    fetchUser.mockResolvedValue({ ...base, status: 'locked' });
    renderRoute(routes, PATH, EDITOR);

    fireEvent.click(
      await screen.findByTestId('user-detail-unlock-button', undefined, { timeout: 5000 }),
    );
    await waitFor(() => expect(unlockUser).toHaveBeenCalledTimes(1));
  });

  it('鎖定狀態在詳情與列表同樣是 danger 色調', async () => {
    fetchUser.mockResolvedValue({ ...base, status: 'locked' });
    renderRoute(routes, PATH, EDITOR);

    expect(
      await screen.findByTestId('user-status-chip', undefined, { timeout: 5000 }),
    ).toHaveAttribute('data-tone', 'danger');
  });

  it('改成停用會先確認，確認後才送出', async () => {
    renderRoute(routes, PATH, EDITOR);

    await startEditing();
    fireEvent.click(screen.getByTestId('user-status-select'));
    fireEvent.click(await screen.findByRole('option', { name: '停用' }));
    fireEvent.click(screen.getByTestId('user-save-button'));

    const confirm = await screen.findByTestId('user-deactivate-confirm');
    expect(confirm).toHaveTextContent('立即被登出');
    expect(updateUser).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser.mock.calls[0]![0].params.body).toEqual({ status: 'inactive', version: 3 });
  });

  describe('樂觀鎖（docs/architecture/backend/03-api-conventions.md §11）', () => {
    it('別人已改過 → 表單上說明並保留輸入，不彈錯誤 toast', async () => {
      updateUser.mockRejectedValue(conflict());
      renderRoute(routes, PATH, EDITOR);

      const input = await startEditing();
      fireEvent.change(input, { target: { value: 'Mine' } });
      fireEvent.submit(screen.getByTestId('user-edit-form'));

      expect(await screen.findByTestId('version-conflict-alert')).toHaveTextContent(
        '已經被其他人修改',
      );
      expect(screen.getByTestId('user-display-name-edit-input')).toHaveValue('Mine');
      expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
    });

    it('按「重新載入」→ 表單換成最新的內容，再次送出帶最新的 version', async () => {
      updateUser.mockRejectedValueOnce(conflict());
      renderRoute(routes, PATH, EDITOR);

      const input = await startEditing();
      fireEvent.change(input, { target: { value: 'Mine' } });
      fireEvent.submit(screen.getByTestId('user-edit-form'));
      await screen.findByTestId('version-conflict-alert');

      fetchUser.mockResolvedValue({ ...base, status: 'active', displayName: 'Theirs', version: 4 });
      fireEvent.click(screen.getByTestId('version-conflict-reload'));
      await waitFor(() =>
        expect(screen.getByTestId('user-display-name-edit-input')).toHaveValue('Theirs'),
      );
      expect(screen.queryByTestId('version-conflict-alert')).not.toBeInTheDocument();

      fireEvent.change(screen.getByTestId('user-display-name-edit-input'), {
        target: { value: 'Mine again' },
      });
      fireEvent.submit(screen.getByTestId('user-edit-form'));
      await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(2));
      expect(updateUser.mock.calls[1]![0].params.body).toEqual({
        displayName: 'Mine again',
        version: 4,
      });
    });

    it('停用時衝突 → 關掉確認框，衝突訊息顯示在表單上', async () => {
      updateUser.mockRejectedValue(conflict());
      renderRoute(routes, PATH, EDITOR);

      await startEditing();
      fireEvent.click(screen.getByTestId('user-status-select'));
      fireEvent.click(await screen.findByRole('option', { name: '停用' }));
      fireEvent.click(screen.getByTestId('user-save-button'));
      fireEvent.click(
        within(await screen.findByTestId('user-deactivate-confirm')).getByTestId(
          'alert-dialog-confirm',
        ),
      );

      expect(await screen.findByTestId('version-conflict-alert')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByTestId('user-deactivate-confirm')).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId('user-edit-form')).toBeInTheDocument();
    });
  });

  it('儲存失敗時編輯區與輸入保留', async () => {
    updateUser.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, PATH, EDITOR);

    const input = await startEditing();
    fireEvent.change(input, { target: { value: 'Keep me' } });
    fireEvent.submit(screen.getByTestId('user-edit-form'));

    expect(await screen.findByTestId('toast')).toHaveAttribute('data-value', 'error');
    expect(screen.getByTestId('user-display-name-edit-input')).toHaveValue('Keep me');
  });

  it('使用者不存在時說明原因並提供回到列表', async () => {
    fetchUser.mockRejectedValue(new AppError('USER_NOT_FOUND', 404));
    const { router } = renderRoute(routes, PATH, EDITOR);

    const error = await screen.findByTestId('user-detail-error', undefined, { timeout: 5000 });
    expect(error).toHaveTextContent('找不到');
    fireEvent.click(screen.getByTestId('user-detail-back'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/user'));
  });

  it('沒有 user:update → 不顯示編輯與解鎖', async () => {
    fetchUser.mockResolvedValue({ ...base, status: 'locked' });
    renderRoute(routes, PATH, ['user:read'] as PermissionKey[]);

    await screen.findByTestId('user-status-chip', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-edit-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('user-detail-unlock-button')).not.toBeInTheDocument();
  });

  it('權限未水合 → 不閃現編輯', async () => {
    renderRoute(routes, PATH, 'unhydrated');

    await screen.findByTestId('user-status-chip', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-edit-button')).not.toBeInTheDocument();
  });

  it('有 group:read → 列出所屬群組，直接所屬的在前（ADR-0024 G4）', async () => {
    renderRoute(routes, PATH, ['user:read', 'group:read'] as PermissionKey[]);
    const groups = await screen.findAllByTestId('user-group', undefined, { timeout: 5000 });
    expect(groups.map((group) => group.getAttribute('data-value'))).toEqual(['g-design', 'g-art']);
    expect(fetchGroups.mock.calls[0]![0].params).toMatchObject({ userId: USER_ID });
  });

  it('沒有 group:read → 不顯示所屬群組', async () => {
    renderRoute(routes, PATH, EDITOR);
    await screen.findByTestId('user-edit-button', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('user-group-section')).not.toBeInTheDocument();
    expect(fetchGroups).not.toHaveBeenCalled();
  });
});
