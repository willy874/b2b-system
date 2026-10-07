import { sessionStore } from '@b2b-system/web-core/auth';
import { AppError } from '@b2b-system/web-core/errors';
import { SessionWatcher } from '@b2b-system/web-core/shell';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPublic } from '@/app/sessionRedirect';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerAccountPagePermissions, Routes } from '../../..';
import accountZhTW from '../../../locales/zh_TW.json';

const { fetchProfile, changePassword, updateProfile } = vi.hoisted(() => ({
  fetchProfile: vi.fn(),
  changePassword: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@/apis/auth/change-password/fetcher', () => ({
  fetchChangePasswordMutation: changePassword,
}));
vi.mock('@/apis/auth/update-profile/fetcher', () => ({
  fetchUpdateProfileMutation: updateProfile,
}));

const routes = [Routes.ProfileRoute];
const NEW_PASSWORD = 'correct horse battery';

beforeAll(() => initTestI18n(accountZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerAccountPagePermissions();
  const profile = {
    admin: { id: 'me', email: 'me@acme.test', displayName: 'Me', role: 'operator' },
    permissions: ['tenant:read', 'platformJob:retry'],
  };
  fetchProfile.mockReset().mockResolvedValue(profile);
  changePassword.mockReset().mockResolvedValue(undefined);
  updateProfile
    .mockReset()
    .mockImplementation(({ params }: { params: { displayName: string } }) =>
      Promise.resolve({ ...profile, admin: { ...profile.admin, displayName: params.displayName } }),
    );
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

  it('★ 真的結束 session：經 SessionWatcher 導到登入頁（reason=password_changed），不被未儲存提醒擋下', async () => {
    sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });
    const { router } = renderRoute(routes, '/profile', []);
    // 與 app/App.tsx 相同的接法
    render(<SessionWatcher router={router} loginPath="/login" isPublic={isPublic} />);
    await fillPasswords('old password 123', NEW_PASSWORD, NEW_PASSWORD);
    fireEvent.click(screen.getByTestId('profile-change-password'));
    fireEvent.click(
      within(await screen.findByTestId('profile-change-password-confirm')).getByTestId(
        'alert-dialog-confirm',
      ),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toMatchObject({
      signedOut: 'true',
      reason: 'password_changed',
      redirect: '/profile',
    });
    expect(screen.queryByTestId('unsaved-changes-confirm')).not.toBeInTheDocument();
    sessionStore.clear();
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

describe('ProfilePage 的名稱、角色與權限', () => {
  it('改名稱送出修剪前的值，角色與角色帶來的權限唯讀列出', async () => {
    renderRoute(routes, '/profile', []);
    expect(await screen.findByTestId('profile-role')).toHaveTextContent('營運人員');
    const permissions = screen.getAllByTestId('profile-permission');
    expect(permissions.map((item) => item.dataset.value)).toEqual([
      'tenant:read',
      'platformJob:retry',
    ]);
    expect(permissions[0]).toHaveTextContent('檢視租戶');

    fireEvent.change(screen.getByTestId('profile-display-name'), { target: { value: '新名字' } });
    fireEvent.click(screen.getByTestId('profile-save'));
    await waitFor(() =>
      expect(updateProfile.mock.calls[0]![0]).toMatchObject({ params: { displayName: '新名字' } }),
    );
  });
});
