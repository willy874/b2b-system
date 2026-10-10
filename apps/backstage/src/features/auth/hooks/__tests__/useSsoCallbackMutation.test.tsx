import { sessionStore } from '@b2b-system/web-core/auth';
import { queryClient } from '@b2b-system/web-core/cache';
import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSsoCallbackMutation } from '../useSsoCallbackMutation';

const exchange = vi.hoisted(() => vi.fn());
vi.mock('@/apis/auth/sso-callback/fetcher', () => ({ fetchSsoCallbackMutation: exchange }));

const PREVIOUS_KEY = ['previous-user', 'list'];

beforeEach(() => {
  exchange.mockReset();
  sessionStore.clear();
  queryClient.setQueryData(PREVIOUS_KEY, ['上一個人的資料']);
});

afterEach(() => {
  sessionStore.clear();
  queryClient.clear();
});

describe('useSsoCallbackMutation（授權碼換 app session）', () => {
  it('成功 → 帶授權碼與 verifier 呼叫，token 寫進 session store，清掉上一個人的快取', async () => {
    exchange.mockResolvedValue({ accessToken: 'new-token', expiresIn: 300 });
    const { result } = renderHook(() => useSsoCallbackMutation(), { wrapper: AllProviders });
    const variables = { params: { code: 'auth-code', codeVerifier: 'verifier' } as never };
    act(() => result.current.mutate(variables));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(exchange.mock.calls[0]![0]).toEqual(variables);
    expect(sessionStore.getAccessToken()).toBe('new-token');
    expect(sessionStore.hasSession()).toBe(true);
    expect(queryClient.getQueryData(PREVIOUS_KEY)).toBeUndefined();
  });

  it('失敗 → 不建立 session、快取不動，錯誤交給頁面', async () => {
    exchange.mockRejectedValue(new AppError('AUTH_INVALID_CREDENTIALS', 401));
    const { result } = renderHook(() => useSsoCallbackMutation(), { wrapper: AllProviders });
    act(() => result.current.mutate({ params: { code: 'bad' } as never }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(sessionStore.getAccessToken()).toBeUndefined();
    expect(queryClient.getQueryData(PREVIOUS_KEY)).toEqual(['上一個人的資料']);
  });
});
