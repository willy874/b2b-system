import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AbortReason,
  abortRequests,
  HttpContext,
  isNetworkError,
  isRequestAborted,
} from '@/core/client';
import type {
  ErrorInterceptor,
  FetcherResponse,
  RequestAbortedError,
  RequestInterceptor,
} from '@/core/client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 模擬真實 fetch：signal 中止時以 signal.reason reject。 */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('預期 reject，但 resolve 了');
}

describe('HttpContext', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('每次送出（含重放）都重跑請求攔截器', async () => {
    let token = 'old';
    const addToken: RequestInterceptor = async (request) => ({
      ...request,
      init: { ...request.init, headers: { authorization: token } },
    });
    const replay: ErrorInterceptor = async (_error, _request, retry) => {
      token = 'new';
      return retry();
    };
    fetchMock.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(json(200, 1));
    const http = new HttpContext({
      name: 'test',
      baseUrl: '',
      requestInterceptors: [addToken],
      errorInterceptors: [replay],
    });

    await http.request('/x');

    const authorizationOf = (call: number) => {
      const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
      return (init?.headers as Record<string, string> | undefined)?.authorization;
    };
    expect(authorizationOf(0)).toBe('old');
    expect(authorizationOf(1)).toBe('new');
  });

  it('fetch 的傳輸層失敗換成 NetworkError（保留原始錯誤於 cause）', async () => {
    const cause = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValueOnce(cause);
    const http = new HttpContext({ name: 'test', baseUrl: '' });

    const error = await rejectionOf(http.request('/x'));

    expect(isNetworkError(error)).toBe(true);
    expect((error as Error).cause).toBe(cause);
  });

  it('非 JSON 的回應本文不會變成解析錯誤，交給狀態碼判斷', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));
    const http = new HttpContext({ name: 'test', baseUrl: '' });

    const response = await http.request('/x');

    expect(response).toMatchObject({ status: 502, data: undefined });
  });

  it('呼叫端取消 → RequestAbortedError(caller)，且不跑錯誤攔截器', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const onError = vi.fn<ErrorInterceptor>();
    const http = new HttpContext({ name: 'test', baseUrl: '', errorInterceptors: [onError] });
    const controller = new AbortController();

    const pending = rejectionOf(http.request('/x', { signal: controller.signal }));
    controller.abort();

    const error = await pending;
    expect(isRequestAborted(error)).toBe(true);
    expect((error as RequestAbortedError).reason).toBe(AbortReason.CALLER);
    expect(onError).not.toHaveBeenCalled();
  });

  it('abortRequests() 只中止指定 context 的請求', async () => {
    const fetchImpl = hangingFetch();
    vi.stubGlobal('fetch', fetchImpl);
    const auth = new HttpContext({ name: 'auth', baseUrl: '' });
    const base = new HttpContext({ name: 'base', baseUrl: '' });

    const authPending = rejectionOf(auth.request('/a'));
    let baseSettled = false;
    void base.request('/b').catch(() => {
      baseSettled = true;
    });

    abortRequests({ reason: AbortReason.SESSION_ENDED, contexts: ['auth'], detail: 'logout' });

    await expect(authPending).resolves.toMatchObject({
      reason: AbortReason.SESSION_ENDED,
      detail: 'logout',
    });
    await Promise.resolve();
    expect(baseSettled).toBe(false);

    // 收尾：讓 base 的請求結束，避免留下未完成的 promise
    abortRequests({ reason: AbortReason.CALLER, contexts: ['base'] });
  });

  it('逾時 → RequestAbortedError(timeout)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    const http = new HttpContext({ name: 'test', baseUrl: '', timeoutMs: 1_000 });

    const pending = rejectionOf(http.request('/x'));
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({ reason: AbortReason.TIMEOUT });
  });

  it('請求結束後退訂中止匯流排，之後的廣播不影響已完成的請求', async () => {
    fetchMock.mockResolvedValueOnce(json(200, 'ok'));
    const http = new HttpContext({ name: 'test', baseUrl: '' });

    const response: FetcherResponse = await http.request('/x');
    abortRequests({ reason: AbortReason.SESSION_ENDED });

    expect(response.data).toBe('ok');
  });
});
