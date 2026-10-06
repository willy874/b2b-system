import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '../../auth';
import { AppError } from '../../errors';
import { initTestI18n } from '../../testing/i18n';
import { AllProviders } from '../../testing/renderWithPermissions';
import { ChangePasswordSection } from './ChangePasswordSection';
import { useChangePasswordForm } from './useChangePasswordForm';
import type { ChangePasswordRequest } from './useChangePasswordForm';

const NEW_PASSWORD = 'correct horse battery';
const mutationFn = vi.fn<(request: ChangePasswordRequest) => Promise<unknown>>();

function Harness() {
  const form = useChangePasswordForm({
    mutationOptions: { mutationFn },
    sessionEndReason: 'password_changed',
  });
  return (
    <>
      <ChangePasswordSection form={form} username="me@acme.test" />
      <output data-testid="dirty">{String(form.isDirty)}</output>
    </>
  );
}

function renderSection() {
  render(
    <AllProviders>
      <Harness />
    </AllProviders>,
  );
}

function fill(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByTestId('profile-current-password'), { target: { value: current } });
  fireEvent.change(screen.getByTestId('profile-new-password'), { target: { value: next } });
  fireEvent.change(screen.getByTestId('profile-confirm-password'), { target: { value: confirm } });
}

async function submitAndConfirm() {
  fireEvent.click(screen.getByTestId('profile-change-password'));
  const dialog = await screen.findByTestId('profile-change-password-confirm');
  fireEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));
}

beforeAll(() => initTestI18n());
beforeEach(() => {
  mutationFn.mockReset().mockResolvedValue({ success: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChangePasswordSection（個人資料頁的變更密碼）', () => {
  it('密碼欄位有 autocomplete，隱藏的帳號欄讓密碼管理器知道是誰的密碼', () => {
    renderSection();
    expect(screen.getByTestId('profile-current-password')).toHaveAttribute(
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
    const form = screen.getByTestId('profile-password-form');
    expect(form.querySelector('input[autocomplete="username"]')).toHaveValue('me@acme.test');
  });

  it('新密碼太短時即時說明長度要求，不能送出', () => {
    renderSection();
    fill('old', 'short', 'short');
    expect(screen.getByText('至少需要 12 個字元')).toBeInTheDocument();
    expect(screen.getByTestId('profile-change-password')).toBeDisabled();
  });

  it('確認欄不一致時說明原因且不能送出', () => {
    renderSection();
    fill('old password 123', NEW_PASSWORD, 'something else');
    expect(screen.getByText('兩次輸入的密碼不一致')).toBeInTheDocument();
    expect(screen.getByTestId('profile-change-password')).toBeDisabled();
  });

  it('填了目前密碼或新密碼就算未儲存（isDirty），只填確認欄不算', () => {
    renderSection();
    const dirty = screen.getByTestId('dirty');
    expect(dirty).toHaveTextContent('false');
    fireEvent.change(screen.getByTestId('profile-confirm-password'), { target: { value: 'x' } });
    expect(dirty).toHaveTextContent('false');
    fireEvent.change(screen.getByTestId('profile-new-password'), { target: { value: 'x' } });
    expect(dirty).toHaveTextContent('true');
  });

  it('送出前先確認；成功後清空欄位並以傳入的原因結束 session', async () => {
    const endSession = vi.spyOn(sessionStore, 'endSession').mockImplementation(() => undefined);
    renderSection();
    fill('old password 123', NEW_PASSWORD, NEW_PASSWORD);
    fireEvent.click(screen.getByTestId('profile-change-password'));

    const dialog = await screen.findByTestId('profile-change-password-confirm');
    expect(dialog).toHaveTextContent('所有裝置都會被登出');
    expect(mutationFn).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));

    await waitFor(() => expect(endSession).toHaveBeenCalledWith('password_changed'));
    expect(mutationFn.mock.calls[0]?.[0]).toMatchObject({
      params: { currentPassword: 'old password 123', newPassword: NEW_PASSWORD },
    });
    expect(screen.getByTestId('profile-current-password')).toHaveValue('');
  });

  it('目前密碼錯誤：顯示在目前密碼欄，並取消預告的結束原因', async () => {
    const expectEnd = vi.spyOn(sessionStore, 'expectSessionEnd');
    mutationFn.mockRejectedValue(new AppError('AUTH_PASSWORD_MISMATCH', 400));
    renderSection();
    fill('wrong password 1', NEW_PASSWORD, NEW_PASSWORD);
    await submitAndConfirm();

    const current = screen.getByTestId('profile-current-password');
    await waitFor(() => expect(current).toHaveAttribute('aria-invalid', 'true'));
    expect(current).toHaveAccessibleDescription('目前密碼不正確。');
    expect(expectEnd).toHaveBeenCalledWith('password_changed');

    // 改了欄位就清掉它的後端錯誤
    fireEvent.change(current, { target: { value: 'another try 1' } });
    expect(current).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('對應不到欄位的錯誤顯示在表單底部', async () => {
    mutationFn.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderSection();
    fill('old password 123', NEW_PASSWORD, NEW_PASSWORD);
    await submitAndConfirm();

    const form = screen.getByTestId('profile-password-form');
    expect(await within(form).findByRole('alert')).not.toBeEmptyDOMElement();
  });
});
