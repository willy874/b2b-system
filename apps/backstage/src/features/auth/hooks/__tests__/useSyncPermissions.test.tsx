import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSyncPermissions } from '../useSyncPermissions';

const api = vi.hoisted(() => ({ fetchProfile: vi.fn(), hasSession: vi.fn() }));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: api.fetchProfile }));
vi.mock('@b2b-system/web-core/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useHasSession: api.hasSession,
}));

const PROFILE = { user: { id: 'me' }, roles: [], permissions: ['user:read', 'role:read'] };

beforeEach(() => {
  vi.clearAllMocks();
  usePermissionStore.setState({ permissions: new Set(), hydrated: false });
});

describe('useSyncPermissions（profile → permission store 的水合）', () => {
  it('有 session → 取得 profile 後把權限寫進 store 並標為已水合', async () => {
    api.hasSession.mockReturnValue(true);
    api.fetchProfile.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useSyncPermissions(), { wrapper: AllProviders });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(usePermissionStore.getState().hydrated).toBe(true));
    expect([...usePermissionStore.getState().permissions]).toEqual(['user:read', 'role:read']);
    expect(result.current.profile).toEqual(PROFILE);
    expect(result.current.loading).toBe(false);
  });

  it('沒有 session → 不打 profile，權限維持未水合', () => {
    api.hasSession.mockReturnValue(false);
    const { result } = renderHook(() => useSyncPermissions(), { wrapper: AllProviders });
    expect(api.fetchProfile).not.toHaveBeenCalled();
    expect(result.current.profile).toBeUndefined();
    expect(usePermissionStore.getState().hydrated).toBe(false);
  });

  it('取得失敗 → 回傳 error、不動 store；refetch 成功後才水合', async () => {
    api.hasSession.mockReturnValue(true);
    api.fetchProfile.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(PROFILE);
    const { result } = renderHook(() => useSyncPermissions(), { wrapper: AllProviders });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(usePermissionStore.getState().hydrated).toBe(false);
    void result.current.refetch();
    await waitFor(() => expect(usePermissionStore.getState().hydrated).toBe(true));
  });
});
