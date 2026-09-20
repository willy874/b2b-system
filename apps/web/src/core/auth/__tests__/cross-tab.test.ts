import { describe, expect, it, vi } from 'vitest';

import { SessionStore } from '../SessionStore';

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';

describe.runIf(hasBroadcastChannel)('SessionStore 跨分頁協調', () => {
  it('偵測到其他分頁正在續期時等它的結果，不自己打 API', async () => {
    const first = new SessionStore();
    const second = new SessionStore();

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

  it('一處登出，其他分頁跟著結束 session', async () => {
    const first = new SessionStore();
    const second = new SessionStore();
    const ended = vi.fn();
    second.events.on('ended', ended);

    second.setTokens({ accessToken: 'token', expiresIn: 300 });
    first.endSession('logout');

    await vi.waitFor(() => expect(ended).toHaveBeenCalled());
    expect(second.hasSession()).toBe(false);

    first.destroy();
    second.destroy();
  });
});
