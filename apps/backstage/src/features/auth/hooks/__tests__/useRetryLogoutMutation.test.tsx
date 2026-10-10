import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRetryLogoutMutation } from '../useRetryLogoutMutation';

const revoke = vi.hoisted(() => vi.fn());
vi.mock('@/apis/auth/logout/fetcher', () => ({ fetchLogoutMutation: revoke }));

beforeEach(() => {
  revoke.mockReset();
});

describe('useRetryLogoutMutation（已登出頁的「重試登出」；docs/architecture/04-sso.md §3.4）', () => {
  it('不帶 token、以空請求撤銷（refresh cookie 由瀏覽器送出）', async () => {
    revoke.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useRetryLogoutMutation(), { wrapper: AllProviders });
    act(() => result.current.mutate());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith({});
  });

  it('撤銷失敗 → mutation 進入錯誤狀態，讓頁面顯示可以再重試', async () => {
    revoke.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useRetryLogoutMutation(), { wrapper: AllProviders });
    act(() => result.current.mutate());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error('network'));
  });
});
