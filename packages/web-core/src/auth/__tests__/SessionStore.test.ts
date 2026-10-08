import { createChannel } from '@b2b-system/web-shared/channel';
import { createFakeChannelHub } from '@b2b-system/web-shared/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkError } from '../../client';
import { AppError } from '../../errors';
import {
  ensureSessionStore,
  getSessionStore,
  IDENTITY_CHANGED_REASON,
  SessionStore,
} from '../SessionStore';
import type { RunExclusive, SessionMessages, SessionTokens } from '../SessionStore';

function createStore(): SessionStore {
  return new SessionStore('test');
}

describe('SessionStore', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it('新鮮的 token 直接回傳，不觸發續期', async () => {
    const store = createStore();
    const refresh = vi.fn();
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'token-1', expiresIn: 300 });

    await expect(store.ensureAccessToken()).resolves.toBe('token-1');
    expect(refresh).not.toHaveBeenCalled();
    store.dispose();
  });

  it('剩餘壽命 < 30 秒時先續期', async () => {
    const store = createStore();
    const refresh = vi.fn().mockResolvedValue({ accessToken: 'token-2', expiresIn: 300 });
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'token-1', expiresIn: 10 });

    await expect(store.ensureAccessToken()).resolves.toBe('token-2');
    expect(refresh).toHaveBeenCalledOnce();
    store.dispose();
  });

  it('★ 單飛：同時多個請求只觸發一次續期', async () => {
    const store = createStore();
    let resolveRefresh: ((value: { accessToken: string; expiresIn: number }) => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<{ accessToken: string; expiresIn: number }>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });

    const first = store.ensureAccessToken();
    const second = store.ensureAccessToken();
    // refreshFn 在取得鎖之後才被呼叫，等一個 microtask
    await vi.waitFor(() => expect(resolveRefresh).toBeDefined());
    resolveRefresh?.({ accessToken: 'fresh', expiresIn: 300 });

    await expect(first).resolves.toBe('fresh');
    await expect(second).resolves.toBe('fresh');
    expect(refresh).toHaveBeenCalledOnce();
    store.dispose();
  });

  it('沒有 session 時不嘗試續期', async () => {
    const store = createStore();
    const refresh = vi.fn();
    store.setRefreshFn(refresh);
    await expect(store.ensureAccessToken()).resolves.toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
    store.dispose();
  });

  it('endSession 是 latched：只觸發一次', () => {
    const store = createStore();
    const listener = vi.fn();
    store.events.on('ended', listener);
    store.setTokens({ accessToken: 'token', expiresIn: 300 });

    store.endSession('AUTH_TOKEN_STALE');
    store.endSession('AUTH_REFRESH_REUSED');

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('AUTH_TOKEN_STALE');
    expect(store.getAccessToken()).toBeUndefined();
    store.dispose();
  });

  it('expectSessionEnd：之後不論哪個原因先到，都以預期的原因結束', () => {
    const store = createStore();
    const listener = vi.fn();
    store.events.on('ended', listener);
    store.setTokens({ accessToken: 'token', expiresIn: 300 });

    store.expectSessionEnd('password_changed');
    // 推播的 session.revoked 或請求的 401 比改密碼的回應先到
    store.endSession('AUTH_TOKEN_STALE');
    store.endSession('password_changed');

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('password_changed');
    store.dispose();
  });

  it('expectSessionEnd 取消後（請求失敗）照實際的原因結束', () => {
    const store = createStore();
    const listener = vi.fn();
    store.events.on('ended', listener);
    store.setTokens({ accessToken: 'token', expiresIn: 300 });

    const cancel = store.expectSessionEnd('password_changed');
    cancel();
    store.endSession('AUTH_TOKEN_STALE');

    expect(listener).toHaveBeenCalledWith('AUTH_TOKEN_STALE');
    store.dispose();
  });

  it('取消舊的預告不影響之後的新預告', () => {
    const store = createStore();
    const listener = vi.fn();
    store.events.on('ended', listener);
    store.setTokens({ accessToken: 'token', expiresIn: 300 });

    const cancelFirst = store.expectSessionEnd('password_changed');
    store.expectSessionEnd('mfa_reset');
    cancelFirst();
    store.endSession('AUTH_TOKEN_STALE');

    expect(listener).toHaveBeenCalledWith('mfa_reset');
    store.dispose();
  });

  it('expectSessionEnd 只用一次：結束後重新登入，下一次結束照實際的原因', () => {
    const store = createStore();
    const listener = vi.fn();
    store.events.on('ended', listener);
    store.setTokens({ accessToken: 'token', expiresIn: 300 });

    store.expectSessionEnd('password_changed');
    store.endSession('AUTH_TOKEN_STALE');
    store.setTokens({ accessToken: 'token-2', expiresIn: 300 });
    store.endSession('logout');

    expect(listener).toHaveBeenNthCalledWith(1, 'password_changed');
    expect(listener).toHaveBeenNthCalledWith(2, 'logout');
    store.dispose();
  });

  it('access token 不進 localStorage（只有「有無 session」的旗標）', () => {
    const store = createStore();
    store.setTokens({ accessToken: 'super-secret-token', expiresIn: 300 });
    const dump = JSON.stringify(globalThis.localStorage);
    expect(dump).not.toContain('super-secret-token');
    expect(store.hasSession()).toBe(true);
    store.dispose();
  });

  it('presumeSession：沒有 token 也視為有 session，下一個請求先續期', async () => {
    const store = createStore();
    const refresh = vi.fn().mockResolvedValue({ accessToken: 'token-1', expiresIn: 300 });
    store.setRefreshFn(refresh);
    expect(store.hasSession()).toBe(false);

    store.presumeSession();

    expect(store.hasSession()).toBe(true);
    await expect(store.ensureAccessToken()).resolves.toBe('token-1');
    expect(refresh).toHaveBeenCalledOnce();
    store.dispose();
  });

  it('續期被伺服器拒絕時結束 session（refresh token 過期或帳號被停用）', async () => {
    const store = createStore();
    store.setRefreshFn(() => Promise.reject(new AppError('AUTH_REFRESH_REVOKED', 401)));
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });
    const ended = vi.fn();
    store.events.on('ended', ended);

    await expect(store.ensureAccessToken()).rejects.toThrow(/AUTH_REFRESH_REVOKED/);
    expect(ended).toHaveBeenCalledOnce();
    expect(store.hasSession()).toBe(false);
    store.dispose();
  });

  it.each([
    ['網路錯誤', new NetworkError(new TypeError('Failed to fetch'))],
    ['5xx', new AppError('INTERNAL_ERROR', 503)],
    ['速率限制', new AppError('RATE_LIMITED', 429)],
  ])('★ 續期暫時性失敗（%s）不結束 session，下一次會再試', async (_label, failure) => {
    const store = createStore();
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ accessToken: 'fresh', expiresIn: 300 });
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });
    const ended = vi.fn();
    store.events.on('ended', ended);

    await expect(store.ensureAccessToken()).rejects.toBe(failure);
    expect(ended).not.toHaveBeenCalled();
    expect(store.hasSession()).toBe(true);

    await expect(store.ensureAccessToken()).resolves.toBe('fresh');
    store.dispose();
  });

  it('★ 續期途中登出：晚回來的結果被丟棄，session 不復活', async () => {
    const store = createStore();
    let resolveRefresh: ((value: { accessToken: string; expiresIn: number }) => void) | undefined;
    store.setRefreshFn(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });

    const pending = store.ensureAccessToken();
    await vi.waitFor(() => expect(resolveRefresh).toBeDefined());
    store.endSession('logout');
    resolveRefresh?.({ accessToken: 'zombie', expiresIn: 300 });

    await expect(pending).resolves.toBeUndefined();
    expect(store.getAccessToken()).toBeUndefined();
    expect(store.hasSession()).toBe(false);
    store.dispose();
  });

  it('★ 續期途中登出又重新登入：舊的續期結果不覆蓋新登入的 token', async () => {
    const store = createStore();
    let resolveRefresh: ((value: { accessToken: string; expiresIn: number }) => void) | undefined;
    store.setRefreshFn(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });

    const pending = store.ensureAccessToken();
    await vi.waitFor(() => expect(resolveRefresh).toBeDefined());
    store.endSession('logout');
    store.setTokens({ accessToken: 'new-login', expiresIn: 300 });
    resolveRefresh?.({ accessToken: 'old-family', expiresIn: 300 });

    await expect(pending).resolves.toBeUndefined();
    expect(store.getAccessToken()).toBe('new-login');
    store.dispose();
  });

  it('續期途中登出後，續期被拒也不再觸發第二次 ended', async () => {
    const store = createStore();
    let rejectRefresh: ((error: Error) => void) | undefined;
    store.setRefreshFn(
      () =>
        new Promise((_resolve, reject) => {
          rejectRefresh = reject;
        }),
    );
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });
    const ended = vi.fn();
    store.events.on('ended', ended);

    const pending = store.ensureAccessToken();
    await vi.waitFor(() => expect(rejectRefresh).toBeDefined());
    store.endSession('logout');
    store.setTokens({ accessToken: 'new-login', expiresIn: 300 });
    rejectRefresh?.(new AppError('AUTH_REFRESH_REVOKED', 401));

    await expect(pending).rejects.toThrow(/AUTH_REFRESH_REVOKED/);
    // 舊世代的拒絕不會把重新登入的 session 結束掉
    expect(ended).toHaveBeenCalledOnce();
    expect(store.getAccessToken()).toBe('new-login');
    store.dispose();
  });

  it('沒有注入 refreshFn 時明確報錯', async () => {
    const store = createStore();
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });
    await expect(store.ensureAccessToken()).rejects.toThrow(/refreshFn/);
    store.dispose();
  });

  it('clear 之後 hasSession 為 false', () => {
    const store = createStore();
    store.setTokens({ accessToken: 'token', expiresIn: 300 });
    store.clear();
    expect(store.hasSession()).toBe(false);
    expect(store.getAccessToken()).toBeUndefined();
    store.dispose();
  });

  it('subscribe 在登入 / 登出時通知（讓 React 重新渲染）', () => {
    const store = createStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setTokens({ accessToken: 'token', expiresIn: 300 });
    store.endSession('logout');
    expect(listener).toHaveBeenCalledTimes(3); // setTokens + clear + endSession 的 notify
    store.dispose();
  });

  describe('換成別的身分時不採用（登入 CSRF 的縱深防禦，backend/04-auth.md §2.5）', () => {
    /** 只有 payload 有意義的假 JWT。 */
    const jwt = (claims: { sub: string; tid?: string }) =>
      `h.${btoa(JSON.stringify(claims)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_')}.s`;

    it('續期回來的 token 是另一個人：結束 session（identity_changed），不把它交給請求', async () => {
      const store = createStore();
      const ended = vi.fn();
      store.events.on('ended', ended);
      store.setRefreshFn(
        vi
          .fn()
          .mockResolvedValue({ accessToken: jwt({ sub: 'attacker', tid: 't1' }), expiresIn: 300 }),
      );
      store.setTokens({ accessToken: jwt({ sub: 'victim', tid: 't1' }), expiresIn: 1 });

      await expect(store.ensureAccessToken()).resolves.toBeUndefined();
      expect(ended).toHaveBeenCalledWith(IDENTITY_CHANGED_REASON);
      expect(store.getAccessToken()).toBeUndefined();
      store.dispose();
    });

    it('同一個人在另一個租戶也算換人（tid 不同）', async () => {
      const store = createStore();
      const ended = vi.fn();
      store.events.on('ended', ended);
      store.setRefreshFn(
        vi.fn().mockResolvedValue({ accessToken: jwt({ sub: 'u1', tid: 't2' }), expiresIn: 300 }),
      );
      store.setTokens({ accessToken: jwt({ sub: 'u1', tid: 't1' }), expiresIn: 1 });

      await store.ensureAccessToken();
      expect(ended).toHaveBeenCalledWith(IDENTITY_CHANGED_REASON);
      store.dispose();
    });

    it('其他分頁的 refresh-done 帶來另一個人：一樣結束', async () => {
      const hub = createFakeChannelHub();
      const channel = createChannel<SessionMessages>('session:test', {
        transport: hub.transport(),
      });
      const other = createChannel<SessionMessages>('session:test', { transport: hub.transport() });
      const store = new SessionStore('test', { channel });
      const ended = vi.fn();
      store.events.on('ended', ended);
      store.setTokens({ accessToken: jwt({ sub: 'victim', tid: 't1' }), expiresIn: 300 });

      other.post('refresh-done', {
        accessToken: jwt({ sub: 'attacker', tid: 't1' }),
        expiresAt: Date.now() + 300_000,
      });

      await vi.waitFor(() => expect(ended).toHaveBeenCalledWith(IDENTITY_CHANGED_REASON));
      store.dispose();
      other.close();
    });

    it('同一個人續期、或原本沒有身分（剛登入）時照常採用', async () => {
      const store = createStore();
      const ended = vi.fn();
      store.events.on('ended', ended);
      store.setTokens({ accessToken: jwt({ sub: 'u1', tid: 't1' }), expiresIn: 1 });
      const renewed = jwt({ sub: 'u1', tid: 't1' }).replace('.s', '.s2');
      store.setRefreshFn(vi.fn().mockResolvedValue({ accessToken: renewed, expiresIn: 300 }));

      await expect(store.ensureAccessToken()).resolves.toBe(renewed);
      store.endSession('logout');
      store.setTokens({ accessToken: jwt({ sub: 'u2', tid: 't1' }), expiresIn: 300 });
      expect(store.getAccessToken()).toBe(jwt({ sub: 'u2', tid: 't1' }));
      expect(ended).toHaveBeenCalledTimes(1);
      store.dispose();
    });
  });
});

/** 只有 payload 有意義的假 JWT（payload 直接給字串，可做出格式錯誤的 token）。 */
const jwtOf = (payload: string) =>
  `h.${btoa(payload).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_')}.s`;

describe('SessionStore 的身分解析（getIdentity / getLastIdentity）', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it.each([
    ['有租戶', JSON.stringify({ sub: 'u1', tid: 't1' }), 't1:u1'],
    ['沒有租戶（平台身分）', JSON.stringify({ sub: 'u1' }), ':u1'],
    ['tid 不是字串', JSON.stringify({ sub: 'u1', tid: 42 }), ':u1'],
    ['沒有 sub', JSON.stringify({ tid: 't1' }), undefined],
    ['payload 是 null', 'null', undefined],
    ['payload 是數字', '1', undefined],
    ['payload 不是 JSON', '{not-json', undefined],
  ])('%s → %s', (_label, payload, expected) => {
    const store = createStore();
    store.setTokens({ accessToken: jwtOf(payload), expiresIn: 300 });
    expect(store.getIdentity()).toBe(expected);
    store.dispose();
  });

  it('不是 JWT（測試與 mock 模式的假 token）→ undefined', () => {
    const store = createStore();
    store.setTokens({ accessToken: 'plain-token', expiresIn: 300 });
    expect(store.getIdentity()).toBeUndefined();
    store.dispose();
  });

  it('沒有 token 時 getIdentity 為 undefined', () => {
    const store = createStore();
    expect(store.getIdentity()).toBeUndefined();
    store.dispose();
  });

  it('session 結束後 getLastIdentity 仍記得是誰；之後的假 token 不會把它洗掉', () => {
    const store = createStore();
    store.setTokens({
      accessToken: jwtOf(JSON.stringify({ sub: 'u1', tid: 't1' })),
      expiresIn: 300,
    });
    store.endSession('logout');
    expect(store.getIdentity()).toBeUndefined();
    expect(store.getLastIdentity()).toBe('t1:u1');

    store.setTokens({ accessToken: 'plain-token', expiresIn: 300 });
    expect(store.getLastIdentity()).toBe('t1:u1');
    store.dispose();
  });

  it('格式錯誤的 token 不會被當成換人（無從比對，交給後端驗證）', () => {
    const store = createStore();
    const ended = vi.fn();
    store.events.on('ended', ended);
    store.setTokens({ accessToken: jwtOf(JSON.stringify({ sub: 'u1' })), expiresIn: 300 });
    store.setTokens({ accessToken: jwtOf('{broken'), expiresIn: 300 });
    expect(ended).not.toHaveBeenCalled();
    expect(store.getAccessToken()).toBe(jwtOf('{broken'));
    store.dispose();
  });
});

describe('SessionStore.renewAccessToken（請求被 401 拒絕後）', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it('被拒的仍是目前的 token：即使還沒到期也強制續期', async () => {
    const store = createStore();
    const refresh = vi.fn().mockResolvedValue({ accessToken: 'token-2', expiresIn: 300 });
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'token-1', expiresIn: 300 });

    await expect(store.renewAccessToken('token-1')).resolves.toBe('token-2');
    expect(refresh).toHaveBeenCalledOnce();
    store.dispose();
  });

  it('被拒的 token 已被其他請求換掉：直接沿用新的，不重複續期', async () => {
    const store = createStore();
    const refresh = vi.fn();
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'token-2', expiresIn: 300 });

    await expect(store.renewAccessToken('token-1')).resolves.toBe('token-2');
    expect(refresh).not.toHaveBeenCalled();
    store.dispose();
  });

  it('沒有 token 時（只有 session 旗標）照常續期', async () => {
    const store = createStore();
    const refresh = vi.fn().mockResolvedValue({ accessToken: 'token-1', expiresIn: 300 });
    store.setRefreshFn(refresh);
    store.presumeSession();

    await expect(store.renewAccessToken(undefined)).resolves.toBe('token-1');
    store.dispose();
  });

  it('★ 續期中收到 401：等待同一個續期的結果，不另外續期也不結束 session（10-testing §6）', async () => {
    const store = createStore();
    let resolveRefresh: ((value: SessionTokens) => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<SessionTokens>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });
    const ended = vi.fn();
    store.events.on('ended', ended);

    const pending = store.ensureAccessToken();
    const renewed = store.renewAccessToken('stale');
    await vi.waitFor(() => expect(resolveRefresh).toBeDefined());
    resolveRefresh?.({ accessToken: 'fresh', expiresIn: 300 });

    await expect(pending).resolves.toBe('fresh');
    await expect(renewed).resolves.toBe('fresh');
    expect(refresh).toHaveBeenCalledOnce();
    expect(ended).not.toHaveBeenCalled();
    store.dispose();
  });
});

describe('SessionStore 的跨分頁互斥', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('等鎖期間其他分頁已續期完成：拿到鎖後沿用新 token，不再打續期', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runExclusive: RunExclusive = async (_name, task) => {
      await held;
      return task();
    };
    const store = new SessionStore('test', { runExclusive });
    const refresh = vi.fn();
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });

    const pending = store.ensureAccessToken();
    // 持有鎖的分頁續期完成，經由 refresh-done 送來新 token
    store.setTokens({ accessToken: 'from-peer', expiresIn: 300 });
    release?.();

    await expect(pending).resolves.toBe('from-peer');
    expect(refresh).not.toHaveBeenCalled();
    store.dispose();
  });

  it('等鎖期間本分頁已登出：拿到鎖後不續期', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runExclusive: RunExclusive = async (_name, task) => {
      await held;
      return task();
    };
    const store = new SessionStore('test', { runExclusive });
    const refresh = vi.fn();
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });

    const pending = store.ensureAccessToken();
    store.endSession('logout');
    release?.();

    await expect(pending).resolves.toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
    store.dispose();
  });

  it('★ 持有鎖的分頁沒有送來結果（廣播遺失或續期失敗）：拿到鎖後自己續期，不永久等待（10-testing §6）', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runExclusive: RunExclusive = async (_name, task) => {
      await held;
      return task();
    };
    const store = new SessionStore('test', { runExclusive });
    const refresh = vi.fn().mockResolvedValue({ accessToken: 'self', expiresIn: 300 });
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });

    const pending = store.ensureAccessToken();
    release?.();

    await expect(pending).resolves.toBe('self');
    expect(refresh).toHaveBeenCalledOnce();
    store.dispose();
  });

  it('預設以 navigator.locks 互斥，鎖名帶後端名稱', async () => {
    const request = vi.fn((_name: string, task: () => Promise<unknown>) => task());
    vi.stubGlobal('navigator', { ...globalThis.navigator, locks: { request } });
    const store = new SessionStore('locked');
    store.setRefreshFn(vi.fn().mockResolvedValue({ accessToken: 'fresh', expiresIn: 300 }));
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });

    await expect(store.ensureAccessToken()).resolves.toBe('fresh');
    expect(request).toHaveBeenCalledWith('ge:refresh:locked', expect.any(Function));
    store.dispose();
  });

  it('瀏覽器不支援 Web Locks：退回分頁內單飛，仍能續期', async () => {
    vi.stubGlobal('navigator', { ...globalThis.navigator, locks: undefined });
    const store = createStore();
    const refresh = vi.fn().mockResolvedValue({ accessToken: 'fresh', expiresIn: 300 });
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });

    const [first, second] = await Promise.all([
      store.ensureAccessToken(),
      store.ensureAccessToken(),
    ]);
    expect([first, second]).toEqual(['fresh', 'fresh']);
    expect(refresh).toHaveBeenCalledOnce();
    store.dispose();
  });

  it('★ BroadcastChannel 不可用：降級為單分頁行為，登入、續期、登出照常（10-testing §6）', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const store = createStore();
    const ended = vi.fn();
    store.events.on('ended', ended);
    store.setRefreshFn(vi.fn().mockResolvedValue({ accessToken: 'fresh', expiresIn: 300 }));
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });

    await expect(store.ensureAccessToken()).resolves.toBe('fresh');
    store.endSession('logout');
    expect(ended).toHaveBeenCalledWith('logout');
    expect(store.hasSession()).toBe(false);
    store.dispose();
  });
});

describe('ensureSessionStore / getSessionStore', () => {
  it('同一個名稱只建立一個實例', () => {
    const store = ensureSessionStore('reports');
    expect(ensureSessionStore('reports')).toBe(store);
    expect(getSessionStore('reports')).toBe(store);
  });

  it('取用尚未建立的 session → 明確報錯，不默默建一個空的', () => {
    expect(() => getSessionStore('typo')).toThrow('SessionStore "typo" 尚未建立');
  });
});
