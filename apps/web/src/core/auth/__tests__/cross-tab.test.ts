import { describe, expect, it, vi } from 'vitest';

import { AppError } from '@/core/errors';

import { SessionStore } from '../SessionStore';
import type { RunExclusive, SessionTokens } from '../SessionStore';

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';

/** 模擬 `navigator.locks`：同名的 task 依序執行（同一個瀏覽器的所有分頁共用）。 */
function createLocks(): RunExclusive {
  const tails = new Map<string, Promise<unknown>>();
  return (name, task) => {
    const run = (tails.get(name) ?? Promise.resolve()).then(task);
    tails.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  };
}

/**
 * 模擬後端的輪替 refresh token 與瀏覽器共用的 cookie：
 * 同一個 cookie 被用第二次就是重用（`AUTH_REFRESH_REUSED`）。
 */
function createRotatingBackend() {
  let cookie = 0;
  const used = new Set<number>();
  let active = 0;
  let maxActive = 0;
  const refresh = async (): Promise<SessionTokens> => {
    const sent = cookie;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    if (used.has(sent)) throw new AppError('AUTH_REFRESH_REUSED', 401);
    used.add(sent);
    cookie = sent + 1; // Set-Cookie：換成新的 refresh token
    return { accessToken: `access-${cookie}`, expiresIn: 300 };
  };
  return { refresh, maxActive: () => maxActive };
}

describe.runIf(hasBroadcastChannel)('SessionStore 跨分頁協調', () => {
  it('★ 多個分頁同時續期（例：闔上筆電後喚醒）：依序執行，不會觸發重用偵測', async () => {
    const locks = createLocks();
    const backend = createRotatingBackend();
    const tabs = [1, 2, 3].map(() => new SessionStore('test', { runExclusive: locks }));
    for (const tab of tabs) {
      tab.setRefreshFn(vi.fn(backend.refresh));
      tab.setTokens({ accessToken: 'stale', expiresIn: 1 });
    }

    const results = await Promise.all(tabs.map((tab) => tab.ensureAccessToken()));

    for (const token of results) expect(token).toMatch(/^access-/);
    expect(backend.maxActive()).toBe(1);
    for (const tab of tabs) {
      expect(tab.hasSession()).toBe(true);
      tab.destroy();
    }
  });

  it('其他分頁續期完成時，新 token 同步過來', async () => {
    const locks = createLocks();
    const first = new SessionStore('test', { runExclusive: locks });
    const second = new SessionStore('test', { runExclusive: locks });
    first.setRefreshFn(vi.fn().mockResolvedValue({ accessToken: 'fresh', expiresIn: 300 }));
    first.setTokens({ accessToken: 'stale', expiresIn: 1 });

    await expect(first.ensureAccessToken()).resolves.toBe('fresh');
    await vi.waitFor(() => expect(second.getAccessToken()).toBe('fresh'));

    first.destroy();
    second.destroy();
  });

  it('★ 已登出的分頁不被其他分頁晚到的續期結果救活', async () => {
    const first = new SessionStore('test', { runExclusive: createLocks() });
    const second = new SessionStore('test', { runExclusive: createLocks() });
    first.setRefreshFn(vi.fn().mockResolvedValue({ accessToken: 'late', expiresIn: 300 }));
    first.setTokens({ accessToken: 'stale', expiresIn: 1 });
    second.setTokens({ accessToken: 'token', expiresIn: 300 });

    second.endSession('logout', false);
    await first.ensureAccessToken();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // hasSession 旗標在 localStorage，各分頁共用，這裡只驗記憶體裡的 token
    expect(second.getAccessToken()).toBeUndefined();

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
