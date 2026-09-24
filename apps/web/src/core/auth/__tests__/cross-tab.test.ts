import { describe, expect, it, vi } from 'vitest';

import { SessionStore } from '../SessionStore';

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';

describe.runIf(hasBroadcastChannel)('SessionStore 跨分頁協調', () => {
  it('偵測到其他分頁正在續期時等它的結果，不自己打 API', async () => {
    const first = new SessionStore('test');
    const second = new SessionStore('test');

    // 讓兩邊互相看見（ping / pong）
    await vi.waitFor(() => expect(second.hasSession()).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));

    let resolveRefresh: ((value: { accessToken: string; expiresIn: number }) => void) | undefined;
    const firstRefresh = vi.fn(
      () =>
        new Promise<{ accessToken: string; expiresIn: number }>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const secondRefresh = vi.fn();
    first.setRefreshFn(firstRefresh);
    second.setRefreshFn(secondRefresh);

    first.setTokens({ accessToken: 'stale-1', expiresIn: 1 });
    second.setTokens({ accessToken: 'stale-2', expiresIn: 1 });

    const firstPromise = first.ensureAccessToken();
    await vi.waitFor(() => expect(resolveRefresh).toBeDefined());

    const secondPromise = second.ensureAccessToken();
    resolveRefresh?.({ accessToken: 'fresh', expiresIn: 300 });

    await expect(firstPromise).resolves.toBe('fresh');
    await expect(secondPromise).resolves.toBeDefined();
    // ★ 第二個分頁沒有自己打 refresh（否則會觸發後端的重用偵測）
    expect(secondRefresh).not.toHaveBeenCalled();

    first.destroy();
    second.destroy();
  });

  it('其他分頁續期失敗時不再乾等，自己續期', async () => {
    const first = new SessionStore('test');
    const second = new SessionStore('test');
    await new Promise((resolve) => setTimeout(resolve, 20));

    let rejectRefresh: ((error: Error) => void) | undefined;
    first.setRefreshFn(
      () =>
        new Promise((_resolve, reject) => {
          rejectRefresh = reject;
        }),
    );
    const secondRefresh = vi.fn().mockResolvedValue({ accessToken: 'own', expiresIn: 300 });
    second.setRefreshFn(secondRefresh);
    first.setTokens({ accessToken: 'stale-1', expiresIn: 1 });
    second.setTokens({ accessToken: 'stale-2', expiresIn: 1 });

    const firstPromise = first.ensureAccessToken();
    await vi.waitFor(() => expect(rejectRefresh).toBeDefined());
    // 等 second 收到 refresh-start
    await new Promise((resolve) => setTimeout(resolve, 20));
    const startedAt = Date.now();
    const secondPromise = second.ensureAccessToken();
    rejectRefresh?.(new Error('network'));

    await expect(firstPromise).rejects.toThrow('network');
    await expect(secondPromise).resolves.toBe('own');
    // 沒有等到 3 秒逾時
    expect(Date.now() - startedAt).toBeLessThan(1_000);

    first.destroy();
    second.destroy();
  });

  it('一處登出，其他分頁跟著結束 session', async () => {
    const first = new SessionStore('test');
    const second = new SessionStore('test');
    const ended = vi.fn();
    second.events.on('ended', ended);

    second.setTokens({ accessToken: 'token', expiresIn: 300 });
    first.endSession('logout');

    await vi.waitFor(() => expect(ended).toHaveBeenCalled());
    expect(second.hasSession()).toBe(false);

    first.destroy();
    second.destroy();
  });

  it('★ 不同後端的 session 互不干擾：續期結果與登出都不外溢', async () => {
    const main = new SessionStore('main-x');
    const reports = new SessionStore('reports-x');
    await new Promise((resolve) => setTimeout(resolve, 20));
    main.setRefreshFn(vi.fn().mockResolvedValue({ accessToken: 'main-fresh', expiresIn: 300 }));
    main.setTokens({ accessToken: 'main-stale', expiresIn: 1 });
    reports.setTokens({ accessToken: 'reports-token', expiresIn: 300 });
    const reportsEnded = vi.fn();
    reports.events.on('ended', reportsEnded);

    await expect(main.ensureAccessToken()).resolves.toBe('main-fresh');
    main.endSession('logout');
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 另一個後端既沒有被換成 main 的 token，也沒有跟著登出
    expect(reports.getAccessToken()).toBe('reports-token');
    expect(reports.hasSession()).toBe(true);
    expect(reportsEnded).not.toHaveBeenCalled();

    main.destroy();
    reports.destroy();
  });
});
