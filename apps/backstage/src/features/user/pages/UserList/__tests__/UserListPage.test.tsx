import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerUserPagePermissions, Routes } from '../../..';
import userZhTW from '../../../locales/zh_TW.json';

const { fetchUsers, fetchProfile, resetPassword, fetchTags } = vi.hoisted(() => ({
  fetchUsers: vi.fn(),
  fetchProfile: vi.fn(),
  resetPassword: vi.fn(),
  fetchTags: vi.fn(),
}));
vi.mock('@/apis/tag/get-tag-list/fetcher', () => ({ fetchTagListQuery: fetchTags }));
vi.mock('@/apis/user/get-user-list/fetcher', () => ({ fetchUserListQuery: fetchUsers }));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@/apis/user/reset-user-password/fetcher', () => ({
  fetchUserResetPasswordMutation: resetPassword,
}));

const USER = {
  id: 'u1',
  email: 'locked@acme.test',
  username: null,
  displayName: 'Locked Person',
  status: 'locked',
  roles: [],
  tags: [{ id: 't1', name: '研發部', color: 'brand' }],
  lastLoginAt: null,
  createdAt: '2026-09-30T00:00:00.000Z',
};
const ADMIN = ['user:read', 'user:update', 'user:resetPassword', 'user:delete'] as PermissionKey[];
const routes = [Routes.UserListRoute];

beforeAll(() => initTestI18n(userZhTW));

beforeEach(() => {
  fetchTags.mockReset().mockResolvedValue({ items: [] });
  resetPagePermissionRegistry();
  registerUserPagePermissions();
  fetchUsers.mockReset().mockResolvedValue({ items: [USER], pagination: { total: 1 } });
  fetchProfile.mockReset().mockResolvedValue({ user: { id: 'me' }, permissions: [] });
  resetPassword.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('UserListPage', () => {
  it('標籤欄顯示貼著的標籤；依標籤篩選以 tagId 查詢（docs/architecture/backend/18-tag.md §7.2 D6）', async () => {
    renderRoute(routes, '/user?tagId=11111111-1111-4111-8111-111111111111', ADMIN);
    await screen.findByText('Locked Person', undefined, { timeout: 5000 });
    expect(screen.getByTestId('tag-chip')).toHaveTextContent('研發部');
    expect(fetchUsers.mock.calls.at(-1)![0]).toMatchObject({
      params: { tagId: ['11111111-1111-4111-8111-111111111111'] },
    });
  });

  it('重設密碼先確認寄到哪個 Email；確認後才寄出，且只寄一次', async () => {
    renderRoute(routes, '/user', ADMIN);
    // 第一次載入 lazy 頁面比較久
    await screen.findByText('Locked Person', undefined, { timeout: 5000 });

    fireEvent.click(screen.getByTestId('user-reset-password-button'));
    const confirm = await screen.findByTestId('user-reset-password-confirm');
    expect(confirm).toHaveTextContent('locked@acme.test');
    expect(resetPassword).not.toHaveBeenCalled();

    const submit = within(confirm).getByTestId('alert-dialog-confirm');
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() =>
      expect(screen.queryByTestId('user-reset-password-confirm')).not.toBeInTheDocument(),
    );
    expect(resetPassword).toHaveBeenCalledTimes(1);
  });

  it('取消確認就不寄信', async () => {
    renderRoute(routes, '/user', ADMIN);

    fireEvent.click(await screen.findByTestId('user-reset-password-button'));
    fireEvent.click(await screen.findByTestId('alert-dialog-cancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('user-reset-password-confirm')).not.toBeInTheDocument(),
    );
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('列表查詢失敗時顯示錯誤與重試，不是「沒有資料」', async () => {
    fetchUsers.mockRejectedValueOnce(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, '/user', ADMIN);

    const error = await screen.findByTestId('rich-table-error');
    expect(screen.queryByText('沒有資料')).not.toBeInTheDocument();
    fireEvent.click(within(error).getByTestId('query-error-retry'));
    expect(await screen.findByText('Locked Person')).toBeInTheDocument();
  });

  it('搜尋框常駐在列表上方，帶入網址上的關鍵字', async () => {
    renderRoute(routes, '/user?keyword=locked', ADMIN);

    expect(await screen.findByTestId('table-search')).toHaveValue('locked');
  });

  it('鎖定狀態在列表是 danger 色調（與詳情一致）', async () => {
    renderRoute(routes, '/user', ADMIN);

    const row = (await screen.findByText('Locked Person')).closest('tr') as HTMLElement;
    expect(within(row).getByText('鎖定')).toHaveAttribute('data-tone', 'danger');
  });

  it('沒有 user:resetPassword → 不顯示重設密碼', async () => {
    renderRoute(routes, '/user', ['user:read'] as PermissionKey[]);

    await screen.findByText('Locked Person');
    expect(screen.queryByTestId('user-reset-password-button')).not.toBeInTheDocument();
  });

  it('權限未水合 → 不閃現重設密碼', async () => {
    renderRoute(routes, '/user', 'unhydrated');

    await screen.findByText('Locked Person');
    expect(screen.queryByTestId('user-reset-password-button')).not.toBeInTheDocument();
  });
});
