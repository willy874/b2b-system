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

const { fetchUser, fetchProfile, updateUser, unlockUser } = vi.hoisted(() => ({
  fetchUser: vi.fn(),
  fetchProfile: vi.fn(),
  updateUser: vi.fn(),
  unlockUser: vi.fn(),
}));
vi.mock('@/apis/user/get-user-detail/fetcher', () => ({ fetchUserDetailQuery: fetchUser }));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@/apis/user/update-user/fetcher', () => ({ fetchUserUpdateMutation: updateUser }));
vi.mock('@/apis/user/unlock-user/fetcher', () => ({ fetchUserUnlockMutation: unlockUser }));

const USER_ID = '44444444-4444-4444-8444-444444444444';
const PATH = `/user/${USER_ID}`;
const base = {
  id: USER_ID,
  email: 'p@acme.test',
  username: null,
  displayName: 'Person',
  roles: [],
  lastLoginAt: null,
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
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

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
    expect(updateUser.mock.calls[0]![0].params.body).toEqual({ displayName: 'Renamed' });
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
    expect(updateUser.mock.calls[0]![0].params.body).toEqual({ status: 'inactive' });
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
});
