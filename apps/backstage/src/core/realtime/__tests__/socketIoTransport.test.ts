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

function setup(hooks: Partial<RealtimeTransportHooks> = {}) {
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
    return socket as unknown as ReturnType<CreateSocketIo>;
  })(allHooks);
  if (!socket) throw new Error('socket 未建立');
  return { transport, socket, hooks: allHooks };
}

describe('socketIoRealtimeTransport：連線設定（docs/architecture/frontend/11-realtime.md §3.1）', () => {
  it('路徑 /api/socket.io、只用 websocket、不自動連線', () => {
    const { socket } = setup();
    expect(socket.options).toMatchObject({
      path: REALTIME_SOCKET_PATH,
      transports: ['websocket'],
      autoConnect: false,
    });
  });

  it('重連退避拉長並加隨機：部署後上千條連線不會在幾秒內一起打回來', () => {
    const { socket } = setup();
    expect(socket.options).toMatchObject(REALTIME_RECONNECTION);
    expect(REALTIME_RECONNECTION.reconnectionDelayMax).toBeGreaterThanOrEqual(30_000);
  });

  it('★ auth 是函式：每次 handshake 都向 authenticate() 取目前的值', async () => {
    let token = 'token-1';
    const { socket, hooks } = setup({ authenticate: vi.fn(async () => ({ token })) });
    expect(typeof socket.options.auth).toBe('function');

    await expect(socket.handshake()).resolves.toEqual({ token: 'token-1' });
    token = 'token-2';
    await expect(socket.handshake()).resolves.toEqual({ token: 'token-2' });
    expect(hooks.authenticate).toHaveBeenCalledTimes(2);
  });

  it('authenticate() 回 undefined：不送 handshake，停在斷線狀態', async () => {
    const { socket } = setup({ authenticate: vi.fn(async () => undefined) });

    await expect(socket.handshake()).resolves.toBeUndefined();
    expect(socket.disconnect).toHaveBeenCalled();
  });
});

describe('socketIoRealtimeTransport：連線事件', () => {
  it('connect → onConnect；isConnected / isActive 讀 socket 的狀態', () => {
    const { transport, socket, hooks } = setup();
    transport.connect();
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
  ])('disconnect（%s）→ byServer=%s', (reason, byServer) => {
    const { socket, hooks } = setup();
    socket.fire('disconnect', reason);
    expect(hooks.onDisconnect).toHaveBeenCalledWith({ byServer });
  });

  it('connect_error：伺服器拒絕時帶出 err.data.code；網路錯誤沒有 code', () => {
    const { socket, hooks } = setup();
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
  it('on 回傳取消訂閱；emit 原樣交給 socket（含 ack）', () => {
    const { transport, socket } = setup();
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

  it('dispose：斷線並移除所有監聽', () => {
    const { transport, socket } = setup();
    transport.dispose();
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.removeAllListeners).toHaveBeenCalled();
  });
});
