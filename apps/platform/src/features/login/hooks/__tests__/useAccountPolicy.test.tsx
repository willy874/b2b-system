import { AllProviders } from '@b2b-system/web-core/testing';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BASE_PASSWORD_MIN_LENGTH, useAccountPolicy } from '../useAccountPolicy';

const { publicSettings } = vi.hoisted(() => ({ publicSettings: vi.fn() }));
vi.mock('@/apis/auth/get-public-settings/query', () => ({
  PUBLIC_SETTINGS_QUERY_KEY: 'PUBLIC_SETTINGS_QUERY_KEY',
  getPublicSettingsQueryOptions: (tenant: string) => ({
    queryKey: ['PUBLIC_SETTINGS_QUERY_KEY', tenant],
    queryFn: () => publicSettings(tenant),
    retry: false,
  }),
}));

beforeEach(() => {
  publicSettings.mockReset();
});

describe('useAccountPolicy（帳號流程要遵守的租戶設定）', () => {
  it('租戶的設定：密碼長度與是否開放註冊取自公開設定', async () => {
    publicSettings.mockResolvedValue({
      values: { 'auth.passwordMinLength': 16, 'auth.registrationEnabled': false },
    });
    const { result } = renderHook(() => useAccountPolicy('acme'), { wrapper: AllProviders });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ passwordMinLength: 16, registrationEnabled: false });
    expect(publicSettings).toHaveBeenCalledWith('acme');
  });

  it('沒有租戶（平台管理者）→ 不查詢，沒有註冊，密碼用基準長度', () => {
    const { result } = renderHook(() => useAccountPolicy(undefined), { wrapper: AllProviders });
    expect(result.current).toEqual({
      passwordMinLength: BASE_PASSWORD_MIN_LENGTH,
      registrationEnabled: false,
      isLoading: false,
    });
    expect(publicSettings).not.toHaveBeenCalled();
  });

  it('讀不到設定 → 退回基準值（後端仍會再檢查）', async () => {
    publicSettings.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useAccountPolicy('acme'), { wrapper: AllProviders });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({
      passwordMinLength: BASE_PASSWORD_MIN_LENGTH,
      registrationEnabled: true,
    });
  });
});
