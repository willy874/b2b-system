import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionStore } from '@/core/auth';

import {
  getActiveRealtimeClient,
  isRealtimeAvailable,
  setActiveRealtimeClient,
} from '../activeClient';
import { RealtimeClient, REALTIME_SOCKET_PATH } from '../RealtimeClient';
import type { RealtimeSocket, RealtimeSocketOptions } from '../RealtimeClient';

type AnyListener = (...args: unknown[]) => void;
type AuthFn = (cb: (data: object) => void) => void;

/**
 * 只模擬 RealtimeClient 用到的 Socket.io 行為：
 * - `active`：呼叫過 `connect()` 且沒有被 `disconnect()` / 伺服器斷線 / handshake 被拒（與 Socket.io 相同）
 * - `connect()` 會呼叫 `auth` 函式取 handshake 資料，記在 `handshakes`
 */
class FakeSocket {
  connected = false;
  private subscribed = false;
  readonly handshakes: object[] = [];
  private readonly listeners = new Map<string, Set<AnyListener>>();
  private readonly auth: AuthFn;

  constructor(readonly options: RealtimeSocketOptions) {
    this.auth = options.auth as AuthFn;
  }

  get active(): boolean {
    return this.subscribed;
  }

  readonly connect = vi.fn(() => {
    this.subscribed = true;
    this.auth((data) => this.handshakes.push(data));
    return this;
  });

  readonly disconnect = vi.fn(() => {
    const wasConnected = this.connected;
    this.subscribed = false;
    this.connected = false;
    if (wasConnected) this.fire('disconnect', 'io client disconnect');
    return this;
  });

  readonly emit = vi.fn((_event: string, ..._args: unknown[]) => this);

  on(event: string, listener: AnyListener) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  off(event: string, listener: AnyListener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  removeAllListeners() {
    this.listeners.clear();
    return this;
  }

  fire(event: string, ...args: unknown[]): void {
    for (const listener of Array.from(this.listeners.get(event) ?? [])) listener(...args);
  }

  // ── 伺服器端的動作 ──
  accept(): void {
    this.connected = true;
    this.fire('connect');
  }

  reject(code?: string): void {
    // handshake middleware 拒絕：Socket.io 不會自動重連（active 變 false）；沒有 code 的網路錯誤則會
    if (code) this.subscribed = false;
    const error = Object.assign(
      new Error(code ?? 'xhr poll error'),
      code ? { data: { code } } : {},
    );
    this.fire('connect_error', error);
  }

  serverDisconnect(): void {
    this.connected = false;
    this.subscribed = false;
    this.fire('disconnect', 'io server disconnect');
  }

  push(event: string, payload?: unknown): void {
    this.fire(event, payload);
  }
}

let sessionSeq = 0;
const created: { client: RealtimeClient; session: SessionStore }[] = [];

function setup({ loggedIn = true }: { loggedIn?: boolean } = {}) {
  sessionSeq += 1;
  // 單一分頁：跨分頁互斥直接執行
  const session = new SessionStore(`realtime-test-${sessionSeq}`, {
    runExclusive: (_name, task) => task(),
  });
  let refreshCount = 0;
  const refresh = vi.fn(async () => {
    refreshCount += 1;
    return { accessToken: `renewed-${refreshCount}`, expiresIn: 300 };
  });
  session.setRefreshFn(refresh);
  if (loggedIn) session.setTokens({ accessToken: 'token-1', expiresIn: 300 });

  let socket: FakeSocket | undefined;
  const client = new RealtimeClient({
    session,
    createSocket: (options) => {
      socket = new FakeSocket(options);
      return socket as unknown as RealtimeSocket;
    },
  });
  created.push({ client, session });
  if (!socket) throw new Error('socket 未建立');
  return { client, session, socket, refresh };
}

/** 啟動並完成第一次 handshake。 */
async function connected(options?: { loggedIn?: boolean }) {
  const context = setup(options);
  context.client.start();
  await vi.waitFor(() => expect(context.socket.handshakes).toHaveLength(1));
  context.socket.accept();
  return context;
}

const change = { resource: 'role', kind: 'update', id: 'role-1' } as const;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const { client, session } of created.splice(0)) {
    client.destroy();
    session.dispose();
  }
  setActiveRealtimeClient(undefined);
});

describe('RealtimeClient：連線設定（docs/architecture/frontend/11-realtime.md §3.1）', () => {
  it('路徑 /api/socket.io、只用 websocket、不自動連線', () => {
    const { socket } = setup();
    expect(socket.options).toMatchObject({
      path: REALTIME_SOCKET_PATH,
      transports: ['websocket'],
      autoConnect: false,
    });
  });

  it('★ auth 是函式：每次（重）連線都拿目前的 token，而不是建立當下的', async () => {
    const { client, session, socket } = setup();
    expect(typeof socket.options.auth).toBe('function');

    client.start();
    await vi.waitFor(() => expect(socket.handshakes).toEqual([{ token: 'token-1' }]));
    socket.accept();

    session.setTokens({ accessToken: 'token-2', expiresIn: 300 });
    socket.serverDisconnect();
    client.connect();
    await vi.waitFor(() => expect(socket.handshakes.at(-1)).toEqual({ token: 'token-2' }));
  });

  it('handshake 前 token 快過期就先續期', async () => {
    const { client, session, socket, refresh } = setup({ loggedIn: false });
    session.setTokens({ accessToken: 'almost-expired', expiresIn: 1 });

    client.start();

    await vi.waitFor(() => expect(socket.handshakes).toEqual([{ token: 'renewed-1' }]));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('RealtimeClient：生命週期（§3）', () => {
  it('沒有 session 時不連線；登入後才連', async () => {
    const { client, session, socket } = setup({ loggedIn: false });
    client.start();
    expect(socket.connect).not.toHaveBeenCalled();

    session.setTokens({ accessToken: 'login-token', expiresIn: 300 });

    await vi.waitFor(() => expect(socket.handshakes).toEqual([{ token: 'login-token' }]));
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('SessionStore 續期（refreshed）時送 session.renew 帶新 token', async () => {
    const { session, socket } = await connected();

    session.setTokens({ accessToken: 'token-2', expiresIn: 300 });

    expect(socket.emit).toHaveBeenCalledWith(
      'session.renew',
      { token: 'token-2' },
      expect.any(Function),
    );
  });

  it('伺服器不接受續期的 token：重新 handshake', async () => {
    const { session, socket } = await connected();
    session.setTokens({ accessToken: 'token-2', expiresIn: 300 });
    const ack = socket.emit.mock.calls[0]?.[2] as (result: unknown) => void;

    ack({ ok: false, code: 'AUTH_TOKEN_INVALID' });

    expect(socket.disconnect).toHaveBeenCalled();
    await vi.waitFor(() => expect(socket.handshakes).toHaveLength(2));
  });

  it('登出（ended）時斷線', async () => {
    const { session, socket } = await connected();

    session.endSession('logout');

    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.connected).toBe(false);
  });

  it('destroy 後斷線，之後的續期不再連線', async () => {
    const { client, session, socket } = await connected();

    client.destroy();
    session.setTokens({ accessToken: 'token-2', expiresIn: 300 });

    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });
});

describe('RealtimeClient：resource.changed（§4）', () => {
  it('驗證後交給 resourceChanged', async () => {
    const { client, socket } = await connected();
    const onChanged = vi.fn();
    client.events.on('resourceChanged', onChanged);

    socket.push('resource.changed', { changes: [change], origin: 'other-tab' });

    expect(onChanged).toHaveBeenCalledWith({ changes: [change], origin: 'other-tab' });
  });

  it('origin 是本分頁的也交出去：leader 要轉給其他分頁，套不套用由協調者決定', async () => {
    const { client, socket } = await connected();
    const onChanged = vi.fn();
    client.events.on('resourceChanged', onChanged);

    socket.push('resource.changed', { changes: [change], origin: 'this-tab' });

    expect(onChanged).toHaveBeenCalledWith({ changes: [change], origin: 'this-tab' });
  });

  it('schema 不合（新舊版本並存）時略過，不拋例外', async () => {
    const { client, socket } = await connected();
    const onChanged = vi.fn();
    client.events.on('resourceChanged', onChanged);

    expect(() =>
      socket.push('resource.changed', { changes: [{ resource: 'unknown', kind: 'update' }] }),
    ).not.toThrow();
    socket.push('resource.changed', 'garbage');

    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('RealtimeClient：重連後的補償（§5）', () => {
  it('connected 事件：第一次連線 resumed=false；重新連上 resumed=true（中間的推播已遺失）', async () => {
    const context = setup();
    const onConnected = vi.fn();
    context.client.events.on('connected', onConnected);
    context.client.start();
    await vi.waitFor(() => expect(context.socket.handshakes).toHaveLength(1));
    context.socket.accept();
    expect(onConnected).toHaveBeenLastCalledWith({ resumed: false });

    context.socket.serverDisconnect();
    context.client.connect();
    await vi.waitFor(() => expect(context.socket.handshakes).toHaveLength(2));
    context.socket.accept();

    expect(onConnected).toHaveBeenLastCalledWith({ resumed: true });
  });
});

describe('RealtimeClient：連線擁有權（§3）', () => {
  it('不是擁有者時不連線；取得擁有權才連', async () => {
    const { client, socket } = setup();
    client.setOwner(false);
    client.start();
    expect(socket.connect).not.toHaveBeenCalled();

    client.setOwner(true);
    await vi.waitFor(() => expect(socket.handshakes).toHaveLength(1));
  });

  it('失去擁有權時斷線，之後的續期也不再連', async () => {
    const { client, socket, session } = await connected();
    client.setOwner(false);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(false);

    session.setTokens({ accessToken: 'token-2', expiresIn: 300 });

    expect(socket.connect).toHaveBeenCalledTimes(1);
  });
});

describe('RealtimeClient：session 事件（§6）', () => {
  it('session.revoked → endSession(reason)', async () => {
    const { session, socket } = await connected();
    const onEnded = vi.fn();
    session.events.on('ended', onEnded);

    socket.push('session.revoked', { reason: 'AUTH_ACCOUNT_DISABLED' });

    expect(onEnded).toHaveBeenCalledWith('AUTH_ACCOUNT_DISABLED');
    expect(session.hasSession()).toBe(false);
  });

  it('session.revoked 的原因看不懂時仍然登出', async () => {
    const { session, socket } = await connected();
    const onEnded = vi.fn();
    session.events.on('ended', onEnded);

    socket.push('session.revoked', { reason: 'SOMETHING_NEW' });

    expect(onEnded).toHaveBeenCalledWith('AUTH_TOKEN_STALE');
  });

  it('session.expired 不是登出：伺服器斷線後重新連線，handshake 先續期', async () => {
    const { session, socket, refresh } = await connected();
    const onEnded = vi.fn();
    session.events.on('ended', onEnded);
    // 閒置分頁：token 已過期
    session.setTokens({ accessToken: 'stale', expiresIn: 0 });

    socket.push('session.expired');
    socket.serverDisconnect();

    await vi.waitFor(() => expect(socket.handshakes.at(-1)).toEqual({ token: 'renewed-1' }));
    expect(refresh).toHaveBeenCalled();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('沒有 session.expired 的伺服器斷線不自己重連', async () => {
    const { socket } = await connected();

    socket.serverDisconnect();

    expect(socket.connect).toHaveBeenCalledTimes(1);
  });
});

describe('RealtimeClient：connect_error（§3.2）', () => {
  it('AUTH_TOKEN_INVALID：續期被拒的那張 token 後重試一次；再失敗就停止', async () => {
    const { client, socket, refresh } = setup();
    client.start();
    await vi.waitFor(() => expect(socket.handshakes).toEqual([{ token: 'token-1' }]));

    socket.reject('AUTH_TOKEN_INVALID');
    await vi.waitFor(() => expect(socket.handshakes).toHaveLength(2));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(socket.handshakes[1]).toEqual({ token: 'renewed-1' });

    socket.reject('AUTH_TOKEN_INVALID');
    await Promise.resolve();
    await Promise.resolve();
    expect(socket.connect).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(['AUTH_TOKEN_STALE', 'AUTH_ACCOUNT_DISABLED'])('%s：結束 session', async (code) => {
    const { client, session, socket } = setup();
    const onEnded = vi.fn();
    session.events.on('ended', onEnded);
    client.start();
    await vi.waitFor(() => expect(socket.handshakes).toHaveLength(1));

    socket.reject(code);

    expect(onEnded).toHaveBeenCalledWith(code);
  });

  it('沒有 code（網路、proxy）：不動 session，交給 Socket.io 的退避重連', async () => {
    const { client, session, socket } = setup();
    client.start();
    await vi.waitFor(() => expect(socket.handshakes).toHaveLength(1));

    socket.reject();

    expect(session.hasSession()).toBe(true);
    expect(socket.active).toBe(true);
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });
});

describe('RealtimeClient：連線狀態', () => {
  it('subscribe 在連上與斷線時通知；沒有協調者時 isRealtimeAvailable 讀本分頁的連線', async () => {
    const { client, socket } = setup();
    setActiveRealtimeClient(client);
    const listener = vi.fn();
    client.subscribe(listener);
    expect(isRealtimeAvailable()).toBe(false);

    client.start();
    await vi.waitFor(() => expect(socket.handshakes).toHaveLength(1));
    socket.accept();
    expect(isRealtimeAvailable()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    socket.serverDisconnect();
    expect(isRealtimeAvailable()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('沒有登記連線（推播停用）時視為斷線', () => {
    expect(getActiveRealtimeClient()).toBeUndefined();
    expect(isRealtimeAvailable()).toBe(false);
  });
});
