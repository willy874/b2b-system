import { sessionStore } from '@b2b-system/web-core/auth';
import { AppError } from '@b2b-system/web-core/errors';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSyncPermissions } from '../useSyncPermissions';

const { fetchProfile } = vi.hoisted(() => ({ fetchProfile: vi.fn() }));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));

function profileOf(permissions: string[]) {
  return { admin: { id: 'a1', name: 'Admin' }, permissions };
}

beforeEach(() => {
  fetchProfile.mockReset();
  usePermissionStore.getState().clear();
  sessionStore.clear();
});

afterEach(() => {
  sessionStore.clear();
});

describe('useSyncPermissions（權限集合的水合）', () => {
  it('沒有 session → 不取 profile，權限維持未水合', () => {
    const { result } = renderHook(() => useSyncPermissions(), { wrapper: AllProviders });
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(result.current.profile).toBeUndefined();
    expect(result.current.loading).toBe(true);
    expect(usePermissionStore.getState().hydrated).toBe(false);
  });

  it('有 session → 取 profile 並把權限寫進 store', async () => {
    sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });
    fetchProfile.mockResolvedValue(profileOf(['tenant:read', 'tenant:update']));
    const { result } = renderHook(() => useSyncPermissions(), { wrapper: AllProviders });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile?.permissions).toEqual(['tenant:read', 'tenant:update']);
    const state = usePermissionStore.getState();
    expect(state.hydrated).toBe(true);
    expect([...state.permissions]).toEqual(['tenant:read', 'tenant:update']);
  });

  it('登入之後（session 出現）才開始取 profile', async () => {
    fetchProfile.mockResolvedValue(profileOf(['tenant:read']));
    renderHook(() => useSyncPermissions(), { wrapper: AllProviders });
    expect(fetchProfile).not.toHaveBeenCalled();

    act(() => sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 }));
    await waitFor(() => expect(usePermissionStore.getState().hydrated).toBe(true));
    expect(fetchProfile).toHaveBeenCalledOnce();
  });

  it('profile 取不到（例：403）→ 不水合，避免以空集合誤判成沒有權限', async () => {
    sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });
    fetchProfile.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const { result } = renderHook(() => useSyncPermissions(), { wrapper: AllProviders });
    await waitFor(() => expect(fetchProfile).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(usePermissionStore.getState().hydrated).toBe(false);
  });
});
