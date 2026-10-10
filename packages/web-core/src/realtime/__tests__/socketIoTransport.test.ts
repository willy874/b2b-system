import { describe, expect, it, vi } from 'vitest';

import {
  REALTIME_RECONNECTION,
  REALTIME_SOCKET_PATH,
  socketIoRealtimeTransport,
} from '../socketIoTransport';
import type { CreateSocketIo } from '../socketIoTransport';
import type { RealtimeTransportHooks } from '../transport';

type AnyListener = (...args: unknown[]) => void;
type SocketOptions = Parameters<CreateSocketIo>[0];
type ContractSocket = Awaited<ReturnType<CreateSocketIo>>;
type AuthFn = (cb: (data: object) => void) => void;

/** 只模擬 adapter 用到的 Socket.io 行為。 */
class FakeSocket {
  connected = false;
  active = false;
  private readonly listeners = new Map<string, Set<AnyListener>>();

  constructor(readonly options: SocketOptions) {}

  readonly connect = vi.fn(() => {
    this.active = true;
    return this;
  });

  readonly disconnect = vi.fn(() => {
    this.active = false;
    this.connected = false;
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

  readonly removeAllListeners = vi.fn(() => {
    this.listeners.clear();
    return this;
  });

  fire(event: string, ...args: unknown[]): void {
    for (const listener of Array.from(this.listeners.get(event) ?? [])) listener(...args);
  }

  /** Socket.io 在每次 handshake 前呼叫 `auth` 函式。 */
  handshake(): Promise<object | undefined> {
    return new Promise((resolve) => {
      (this.options.auth as AuthFn)(resolve);
      // 沒有呼叫 cb（放棄這次連線）時也要讓測試往下走
      setTimeout(() => resolve(undefined), 0);
    });
  }
}

/** 建立 transport 並 `connect()`，等 socket 建立（預設的建立是非同步的動態載入）。 */
async function setup(hooks: Partial<RealtimeTransportHooks> = {}) {
  const created = setupLazy(hooks);
  created.transport.connect();
  const socket = await vi.waitFor(() => {
    if (!created.socket()) throw new Error('socket 未建立');
    return created.socket() as FakeSocket;
  });
  return { transport: created.transport, socket, hooks: created.hooks };
}

/** 只建立 transport，不連線。 */
function setupLazy(hooks: Partial<RealtimeTransportHooks> = {}) {
  let socket: FakeSocket | undefined;
  const allHooks: RealtimeTransportHooks = {
    authenticate: vi.fn(async () => ({ token: 'token-1' })),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onConnectError: vi.fn(),
    ...hooks,
  };
  const transport = socketIoRealtimeTransport((options) => {
    socket = new FakeSocket(options);
    return socket as unknown as ContractSocket;
  })(allHooks);
  return { transport, socket: () => socket, hooks: allHooks };
}

describe('socketIoRealtimeTransport：連線設定（docs/architecture/frontend/11-realtime.md §3.1）', () => {
  it('路徑 /api/socket.io、只用 websocket、不自動連線', async () => {
    const { socket } = await setup();
    expect(socket.options).toMatchObject({
      path: REALTIME_SOCKET_PATH,
      transports: ['websocket'],
      autoConnect: false,
    });
  });

  it('重連退避拉長並加隨機：部署後上千條連線不會在幾秒內一起打回來', async () => {
    const { socket } = await setup();
    expect(socket.options).toMatchObject(REALTIME_RECONNECTION);
    expect(REALTIME_RECONNECTION.reconnectionDelayMax).toBeGreaterThanOrEqual(30_000);
  });

  it('★ auth 是函式：每次 handshake 都向 authenticate() 取目前的值', async () => {
    let token = 'token-1';
    const { socket, hooks } = await setup({ authenticate: vi.fn(async () => ({ token })) });
    expect(typeof socket.options.auth).toBe('function');

    await expect(socket.handshake()).resolves.toEqual({ token: 'token-1' });
    token = 'token-2';
    await expect(socket.handshake()).resolves.toEqual({ token: 'token-2' });
    expect(hooks.authenticate).toHaveBeenCalledTimes(2);
  });

  it('authenticate() 回 undefined：不送 handshake，停在斷線狀態', async () => {
    const { socket } = await setup({ authenticate: vi.fn(async () => undefined) });

    await expect(socket.handshake()).resolves.toBeUndefined();
    expect(socket.disconnect).toHaveBeenCalled();
  });
});

describe('socketIoRealtimeTransport：連線事件', () => {
  it('connect → onConnect；isConnected / isActive 讀 socket 的狀態', async () => {
    const { transport, socket, hooks } = await setup();
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(transport.isActive).toBe(true);

    socket.connected = true;
    socket.fire('connect');

    expect(hooks.onConnect).toHaveBeenCalledTimes(1);
    expect(transport.isConnected).toBe(true);
  });

  it.each([
    ['io server disconnect', true],
    ['io client disconnect', false],
    ['transport close', false],
  ])('disconnect（%s）→ byServer=%s', async (reason, byServer) => {
    const { socket, hooks } = await setup();
    socket.fire('disconnect', reason);
    expect(hooks.onDisconnect).toHaveBeenCalledWith({ byServer });
  });

  it('connect_error：伺服器拒絕時帶出 err.data.code；網路錯誤沒有 code', async () => {
    const { socket, hooks } = await setup();
    const rejected = Object.assign(new Error('AUTH_TOKEN_INVALID'), {
      data: { code: 'AUTH_TOKEN_INVALID' },
    });
    const network = new Error('websocket error');

    socket.fire('connect_error', rejected);
    socket.fire('connect_error', network);

    expect(hooks.onConnectError).toHaveBeenNthCalledWith(1, {
      code: 'AUTH_TOKEN_INVALID',
      cause: rejected,
    });
    expect(hooks.onConnectError).toHaveBeenNthCalledWith(2, { code: undefined, cause: network });
  });
});

describe('socketIoRealtimeTransport：事件', () => {
  it('on 回傳取消訂閱；emit 原樣交給 socket（含 ack）', async () => {
    const { transport, socket } = await setup();
    const listener = vi.fn();
    const off = transport.on('resource.changed', listener);

    socket.fire('resource.changed', { changes: [] });
    off();
    socket.fire('resource.changed', { changes: [] });
    expect(listener).toHaveBeenCalledTimes(1);

    const ack = vi.fn();
    transport.emit('session.renew', { token: 't' }, ack);
    expect(socket.emit).toHaveBeenCalledWith('session.renew', { token: 't' }, ack);
  });

  it('dispose：斷線並移除所有監聽', async () => {
    const { transport, socket } = await setup();
    transport.dispose();
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.removeAllListeners).toHaveBeenCalled();
  });
});

describe('socketIoRealtimeTransport：延後載入（docs/architecture/frontend/11-realtime.md §2）', () => {
  it('connect() 之前不建立 socket；載入中視為連線中', async () => {
    const { transport, socket } = setupLazy();
    expect(socket()).toBeUndefined();
    expect(transport.isActive).toBe(false);
    expect(transport.isConnected).toBe(false);

    transport.connect();
    expect(transport.isActive).toBe(true);
    await vi.waitFor(() => expect(socket()?.connect).toHaveBeenCalledTimes(1));
  });

  it('connect() 之前的 on() 在 socket 建立後補掛；取消訂閱的不掛', async () => {
    const { transport, socket } = setupLazy();
    const kept = vi.fn();
    const removed = vi.fn();
    transport.on('resource.changed', kept);
    transport.on('resource.changed', removed)();

    transport.connect();
    await vi.waitFor(() => expect(socket()).toBeDefined());
    socket()?.fire('resource.changed', { changes: [] });

    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it('載入完成前 disconnect()：建立 socket 但不連線', async () => {
    const { transport, socket } = setupLazy();
    transport.connect();
    transport.disconnect();
    await vi.waitFor(() => expect(socket()).toBeDefined());

    expect(socket()?.connect).not.toHaveBeenCalled();
    expect(transport.isActive).toBe(false);
  });

  it('載入完成前 dispose()：不掛監聽、不連線', async () => {
    const { transport, socket } = setupLazy();
    transport.connect();
    transport.dispose();
    await vi.waitFor(() => expect(socket()).toBeDefined());

    expect(socket()?.connect).not.toHaveBeenCalled();
    expect(socket()?.removeAllListeners).toHaveBeenCalled();
  });

  it('載入失敗：回報沒有錯誤碼的 connect_error，下一次 connect() 重新載入', async () => {
    const onConnectError = vi.fn();
    const failure = new Error('Failed to fetch dynamically imported module');
    const createSocket = vi
      .fn<CreateSocketIo>()
      .mockRejectedValueOnce(failure)
      .mockImplementation((options) => new FakeSocket(options) as unknown as ContractSocket);
    const transport = socketIoRealtimeTransport(createSocket)({
      authenticate: vi.fn(async () => ({ token: 't' })),
      onConnect: vi.fn(),
      onDisconnect: vi.fn(),
      onConnectError,
    });

    transport.connect();
    await vi.waitFor(() =>
      expect(onConnectError).toHaveBeenCalledWith({ code: undefined, cause: failure }),
    );
    expect(transport.isActive).toBe(false);

    transport.connect();
    await vi.waitFor(() => expect(createSocket).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(transport.isActive).toBe(true));
  });
});
