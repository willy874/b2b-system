import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defineAuthFetcher,
  defineBackendFetchers,
  defineBaseFetcher,
  HttpContext,
  registerHttpContext,
  resetHttpContexts,
} from '..';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('defineFetcher（fetcher 定義器）', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    resetHttpContexts();
  });

  afterEach(() => {
    resetHttpContexts();
    vi.unstubAllGlobals();
  });

  const initOf = (call = 0) => fetchMock.mock.calls[call]?.[1] as RequestInit;
  const urlOf = (call = 0) => fetchMock.mock.calls[call]?.[0] as string;

  it('主後端：base 與 auth 各自走 main:base／main:auth 的 context，回傳 data', async () => {
    registerHttpContext(new HttpContext({ name: 'main:base', baseUrl: '/base' }));
    registerHttpContext(new HttpContext({ name: 'main:auth', baseUrl: '/auth' }));
    const login = defineBaseFetcher<void, { ok: boolean }>((http) => http.request('/login'));
    const me = defineAuthFetcher<void, { ok: boolean }>((http) => http.request('/me'));

    await expect(login()).resolves.toEqual({ ok: true });
    await expect(me()).resolves.toEqual({ ok: true });

    expect(urlOf(0)).toBe('/base/login');
    expect(urlOf(1)).toBe('/auth/me');
  });

  it('其他後端以自己的名稱推導 context', async () => {
    registerHttpContext(new HttpContext({ name: 'billing:auth', baseUrl: '/billing' }));
    const { defineAuthFetcher: defineBilling } = defineBackendFetchers('billing');
    const invoices = defineBilling<void, unknown>((http) => http.request('/invoices'));

    await invoices();

    expect(urlOf()).toBe('/billing/invoices');
  });

  it('請求的 cache 自動接上；signal 中止時請求跟著中止，實作漏傳也一樣', async () => {
    registerHttpContext(new HttpContext({ name: 'main:auth', baseUrl: '' }));
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const controller = new AbortController();
    const list = defineAuthFetcher<{ signal: AbortSignal; cache: RequestCache }, unknown>((http) =>
      http.request('/list'),
    );

    const pending = list({ signal: controller.signal, cache: 'no-store' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(initOf().cache).toBe('no-store');
    controller.abort();

    await expect(pending).rejects.toBeDefined();
    expect(initOf().signal?.aborted).toBe(true);
  });

  it('請求不是物件、或 signal／cache 型別不對時忽略', async () => {
    registerHttpContext(new HttpContext({ name: 'main:base', baseUrl: '' }));
    const byId = defineBaseFetcher<unknown, unknown>((http) => http.request('/x'));

    await byId('plain-id');
    await byId({ signal: 'not-a-signal', cache: 1 });

    expect(initOf(0).cache).toBeUndefined();
    expect(initOf(1).cache).toBeUndefined();
  });

  it('context 尚未註冊時拒絕', async () => {
    const orphan = defineBaseFetcher<void, unknown>((http) => http.request('/x'));
    await expect(orphan()).rejects.toThrow('HttpContext "main:base" 尚未註冊');
  });
});
