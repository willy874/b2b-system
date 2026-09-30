import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSessionStore, sessionStore } from '@/core/auth';
import {
  AbortReason,
  backendContextNames,
  getHttpContext,
  isRequestAborted,
  MAIN_BACKEND,
  resetHttpContexts,
} from '@/core/client';
import type { RequestAbortedError } from '@/core/client';

import { httpContextPlugin } from '../http-context';
import type { BackendOptions } from '../http-context';

const refresh = () => Promise.resolve({ accessToken: 'fresh', expiresIn: 300 });

function backend(name: string): BackendOptions {
  return { name, baseUrl: '', refresh };
}

/** 模擬真實 fetch：signal 中止時以 signal.reason reject。 */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
  );
}

function install(backends: BackendOptions[]) {
  // plugin 不讀 context，給一個空物件即可
  return httpContextPlugin(backends)({} as never);
}

describe('httpContextPlugin（多後端，各自獨立的 session）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetHttpContexts();
    sessionStore.clear();
  });

  it('缺少主後端時啟動就報錯', () => {
    expect(() => httpContextPlugin([backend('reports')])).toThrow(MAIN_BACKEND);
  });

  it('每個後端註冊自己的 base / auth 管道與 session', () => {
    install([backend(MAIN_BACKEND), backend('reports-a')]);

    for (const name of [MAIN_BACKEND, 'reports-a']) {
      const names = backendContextNames(name);
      expect(getHttpContext(names.base).name).toBe(names.base);
      expect(getHttpContext(names.auth).name).toBe(names.auth);
      expect(getSessionStore(name).name).toBe(name);
    }
  });

  it('★ 其他後端的 session 結束只中止它自己的請求，主後端不受影響', async () => {
    install([backend(MAIN_BACKEND), backend('reports-b')]);
    vi.stubGlobal('fetch', hangingFetch());
    const reports = getSessionStore('reports-b');
    reports.setTokens({ accessToken: 'reports-token', expiresIn: 300 });
    sessionStore.setTokens({ accessToken: 'main-token', expiresIn: 300 });
    const mainEnded = vi.fn();
    const off = sessionStore.events.on('ended', mainEnded);

    const reportsPending = getHttpContext(backendContextNames('reports-b').auth)
      .request('/r')
      .catch((error: unknown) => error);
    let mainSettled = false;
    const mainPending = getHttpContext(backendContextNames(MAIN_BACKEND).auth)
      .request('/m')
      .catch(() => {
        mainSettled = true;
      });
    // 等兩個請求都跑完請求攔截器、真的送出
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    reports.endSession('AUTH_TOKEN_STALE');

    const error = await reportsPending;
    expect(isRequestAborted(error)).toBe(true);
    expect((error as RequestAbortedError).reason).toBe(AbortReason.SESSION_ENDED);
    await Promise.resolve();
    expect(mainSettled).toBe(false);
    expect(mainEnded).not.toHaveBeenCalled();
    expect(sessionStore.getAccessToken()).toBe('main-token');

    off();
    sessionStore.endSession('cleanup');
    await mainPending;
  });

  it('★ 主 session 結束時，其他後端的 session 一併結束（換人登入不會沿用上一個人的 token）', () => {
    install([backend(MAIN_BACKEND), backend('reports-c')]);
    const reports = getSessionStore('reports-c');
    reports.setTokens({ accessToken: 'reports-token', expiresIn: 300 });
    sessionStore.setTokens({ accessToken: 'main-token', expiresIn: 300 });

    sessionStore.endSession('logout');

    expect(reports.getAccessToken()).toBeUndefined();
    expect(reports.hasSession()).toBe(false);
  });
});
