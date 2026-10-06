import { useLocaleStore, useTimezoneStore } from '@b2b-system/web-core/store';
import { AllProviders, createTestQueryClient } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';

import { useSyncAccountPreferences } from '../useSyncAccountPreferences';

const { fetchProfile } = vi.hoisted(() => ({ fetchProfile: vi.fn() }));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@b2b-system/web-core/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useHasSession: () => true,
}));

function profile(locale: string, timezone: string) {
  return {
    user: { id: 'me', email: 'me@acme.test', displayName: 'Me', preferences: { locale, timezone } },
    roles: [],
    permissions: [],
    features: [],
    flags: [],
  };
}

function renderSync() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AllProviders queryClient={queryClient}>{children}</AllProviders>
  );
  renderHook(() => useSyncAccountPreferences(), { wrapper });
  return queryClient;
}

beforeEach(() => {
  localStorage.clear();
  useLocaleStore.setState({ locale: 'zh-TW' });
  useTimezoneStore.setState({ timezone: 'Asia/Taipei' });
});

afterEach(() => localStorage.clear());

describe('useSyncAccountPreferences（帳號的偏好以帳號為準，docs/architecture/frontend/08-i18n.md §1）', () => {
  it('本機沒有存過偏好：profile 回 en-US／Europe/Berlin → 套用到這台裝置', async () => {
    fetchProfile.mockResolvedValue(profile('en-US', 'Europe/Berlin'));
    renderSync();
    await waitFor(() => expect(useLocaleStore.getState().locale).toBe('en-US'));
    expect(useTimezoneStore.getState().timezone).toBe('Europe/Berlin');
  });

  it('本機的偏好與帳號不同 → 以帳號為準', async () => {
    useLocaleStore.getState().setLocale('en-US');
    fetchProfile.mockResolvedValue(profile('zh-TW', 'Asia/Tokyo'));
    renderSync();
    await waitFor(() => expect(useTimezoneStore.getState().timezone).toBe('Asia/Tokyo'));
    expect(useLocaleStore.getState().locale).toBe('zh-TW');
  });

  it('帳號的值沒變時不再套用：本機剛切換、同步還沒完成時重取到舊的 profile 不會切回去', async () => {
    fetchProfile.mockResolvedValue(profile('zh-TW', 'Europe/Berlin'));
    const queryClient = renderSync();
    // 第一次套用完成
    await waitFor(() => expect(useTimezoneStore.getState().timezone).toBe('Europe/Berlin'));

    act(() => useLocaleStore.getState().setLocale('en-US'));
    await act(() => queryClient.refetchQueries({ queryKey: [AUTH_PROFILE_QUERY_KEY] }));
    expect(fetchProfile).toHaveBeenCalledTimes(2);
    expect(useLocaleStore.getState().locale).toBe('en-US');
  });
});
