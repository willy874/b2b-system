import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { useRegisterForm } from '../useRegisterForm';

const { register, publicSettings } = vi.hoisted(() => ({
  register: vi.fn(),
  publicSettings: vi.fn(),
}));
vi.mock('@/apis/auth/register/mutation', () => ({
  getRegisterMutationOptions: () => ({ mutationFn: register }),
}));
vi.mock('@/apis/auth/get-public-settings/query', () => ({
  PUBLIC_SETTINGS_QUERY_KEY: 'PUBLIC_SETTINGS_QUERY_KEY',
  getPublicSettingsQueryOptions: (tenant: string) => ({
    queryKey: ['PUBLIC_SETTINGS_QUERY_KEY', tenant],
    queryFn: () => publicSettings(tenant),
  }),
}));

function renderForm(tenant: string | undefined = 'acme') {
  return renderHook(() => useRegisterForm(tenant), { wrapper: AllProviders });
}

async function submit(result: { current: ReturnType<typeof useRegisterForm> }, reason = '') {
  const { form } = result.current;
  act(() => {
    form.setFieldValue('email', 'alice@example.com');
    form.setFieldValue('displayName', 'Alice');
    form.setFieldValue('reason', reason);
  });
  await act(() => form.handleSubmit());
}

beforeAll(() => initTestI18n());
beforeEach(() => {
  register.mockReset().mockResolvedValue({ submitted: true });
  publicSettings.mockReset().mockResolvedValue({
    values: { 'auth.passwordMinLength': 12, 'auth.registrationEnabled': true },
  });
});

describe('useRegisterForm（註冊申請的流程）', () => {
  it('租戶關閉了註冊 → closed；載入中不算關閉', async () => {
    publicSettings.mockResolvedValue({ values: { 'auth.registrationEnabled': false } });
    const { result } = renderForm();
    expect(result.current.closed).toBe(false);
    await waitFor(() => expect(result.current.closed).toBe(true));
  });

  it('送出：帶上租戶、理由去掉空白（空的不帶）、不帶密碼，成功後是 submitted', async () => {
    const { result } = renderForm();
    await waitFor(() => expect(result.current.policy.isLoading).toBe(false));
    await submit(result, '  ');
    expect(register.mock.calls[0]?.[0]).toEqual({
      params: {
        tenant: 'acme',
        email: 'alice@example.com',
        displayName: 'Alice',
        reason: undefined,
      },
    });
    expect(result.current.submitted).toBe(true);
  });

  it('email 格式不對時不送出', async () => {
    const { result } = renderForm();
    await waitFor(() => expect(result.current.policy.isLoading).toBe(false));
    act(() => {
      result.current.form.setFieldValue('email', 'not-an-email');
      result.current.form.setFieldValue('displayName', 'Alice');
    });
    await act(() => result.current.form.handleSubmit());
    expect(register).not.toHaveBeenCalled();
    expect(result.current.submitted).toBe(false);
  });

  it('後端拒絕（例：限流）→ 本地化的表單錯誤，不是 submitted', async () => {
    register.mockRejectedValue(new AppError('RATE_LIMITED', 429));
    const { result } = renderForm();
    await waitFor(() => expect(result.current.policy.isLoading).toBe(false));
    await submit(result);
    expect(result.current.formError).toEqual(expect.any(String));
    expect(result.current.submitted).toBe(false);
  });
});
