import { sessionStore } from '@b2b-system/web-core/auth';
import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerAccountPagePermissions, Routes } from '../../..';
import accountZhTW from '../../../locales/zh_TW.json';

const { fetchProfile, changePassword, fetchSources } = vi.hoisted(() => ({
  fetchSources: vi.fn(),
  fetchProfile: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@/apis/user/get-user-permission-sources/fetcher', () => ({
  fetchUserPermissionSourcesQuery: fetchSources,
}));
vi.mock('@/apis/auth/change-password/fetcher', () => ({
  fetchChangePasswordMutation: changePassword,
}));

const routes = [Routes.ProfileRoute];
const NEW_PASSWORD = 'correct horse battery';

beforeAll(() => initTestI18n(accountZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerAccountPagePermissions();
  fetchProfile.mockReset().mockResolvedValue({
    user: { id: 'me', email: 'me@acme.test', displayName: 'Me' },
    roles: [],
    permissions: [],
  });
  changePassword.mockReset().mockResolvedValue(undefined);
  fetchSources.mockReset().mockResolvedValue({
    isSuperAdmin: false,
    superAdminVia: null,
    items: [
      {
        key: 'auditLog:read',
        sources: [
          {
            grantedKey: 'auditLog:read',
            via: [
              { type: 'user', id: 'me', relation: '', name: 'Me', hidden: false },
              { type: 'group', id: null, relation: 'member', name: null, hidden: true },
            ],
          },
        ],
      },
    ],
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function fillPasswords(current: string, next: string, confirm: string) {
  fireEvent.change(await screen.findByTestId('profile-current-password'), {
    target: { value: current },
  });
  fireEvent.change(screen.getByTestId('profile-new-password'), { target: { value: next } });
  fireEvent.change(screen.getByTestId('profile-confirm-password'), { target: { value: confirm } });
}

describe('ProfilePage 的變更密碼', () => {
  it('密碼欄位有 autocomplete，密碼管理器能產生與儲存新密碼', async () => {
    renderRoute(routes, '/profile', []);
    expect(await screen.findByTestId('profile-current-password')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.getByTestId('profile-new-password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    expect(screen.getByTestId('profile-confirm-password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
  });

  it('確認欄不一致時說明原因且不能送出', async () => {
    renderRoute(routes, '/profile', []);
    await fillPasswords('old password 123', NEW_PASSWORD, 'something else');

    expect(screen.getByText('兩次輸入的密碼不一致')).toBeInTheDocument();
    expect(screen.getByTestId('profile-change-password')).toBeDisabled();
  });

  it('太短時即時說明長度要求', async () => {
    renderRoute(routes, '/profile', []);
    await fillPasswords('old', 'short', 'short');

    expect(screen.getByText('至少需要 12 個字元')).toBeInTheDocument();
  });

  it('送出前先說明所有裝置都會登出；成功後以 password_changed 結束 session', async () => {
    const endSession = vi.spyOn(sessionStore, 'endSession').mockImplementation(() => undefined);
    renderRoute(routes, '/profile', []);
    await fillPasswords('old password 123', NEW_PASSWORD, NEW_PASSWORD);
    fireEvent.click(screen.getByTestId('profile-change-password'));

    const confirm = await screen.findByTestId('profile-change-password-confirm');
    expect(confirm).toHaveTextContent('所有裝置都會被登出');
    expect(changePassword).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));

    await waitFor(() => expect(endSession).toHaveBeenCalledWith('password_changed'));
    expect(changePassword.mock.calls[0]![0]).toMatchObject({
      params: { currentPassword: 'old password 123', newPassword: NEW_PASSWORD },
    });
  });

  it('目前密碼錯誤時錯誤顯示在目前密碼欄', async () => {
    changePassword.mockRejectedValue(new AppError('AUTH_PASSWORD_MISMATCH', 400));
    renderRoute(routes, '/profile', []);
    await fillPasswords('wrong password 1', NEW_PASSWORD, NEW_PASSWORD);
    fireEvent.click(screen.getByTestId('profile-change-password'));
    fireEvent.click(
      within(await screen.findByTestId('profile-change-password-confirm')).getByTestId(
        'alert-dialog-confirm',
      ),
    );

    const current = screen.getByTestId('profile-current-password');
    await waitFor(() => expect(current).toHaveAttribute('aria-invalid', 'true'));
    expect(current).toHaveAccessibleDescription('目前密碼不正確。');
  });
});

describe('ProfilePage 的有效權限（docs/architecture/iam/01-model.md §9 G4b）', () => {
  it('不需要任何權限：展開才以自己的 id 查，讀不到的節點顯示種類', async () => {
    renderRoute(routes, '/profile', []);
    fireEvent.click(await screen.findByTestId('profile-permission-sources-show'));
    const item = await screen.findByTestId('permission-source');
    expect(item).toHaveAttribute('data-value', 'auditLog:read');
    expect(within(item).getAllByTestId('explain-node')[1]).toHaveAttribute('data-hidden', 'true');
    expect(fetchSources.mock.calls[0]![0].params).toEqual({ userId: 'me' });
  });
});
