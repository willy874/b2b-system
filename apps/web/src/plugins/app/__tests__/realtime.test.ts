import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/core/auth';
import { MAIN_BACKEND } from '@/core/client';
import { getActiveRealtimeClient, isRealtimeAvailable } from '@/core/realtime';
import type { RealtimeSocket } from '@/core/realtime';
import { createChannel } from '@/shared/channel';
import type { LeaderElectionAdapters, LeaderMessages } from '@/shared/leader';
import { createFakeChannelHub } from '@/test/fakeChannelHub';

import { realtimePlugin } from '../realtime';

type AnyListener = (...args: unknown[]) => void;
const CLAIM_WINDOW = 401;
const JITTER_MAX = 750;

/** plugin 只需要 socket 能註冊監聽與連線；連線細節由 RealtimeClient 的測試負責。 */
function fakeSocket() {
  const listeners = new Map<string, Set<AnyListener>>();
  const socket = {
    connected: false,
    active: false,
    connect: vi.fn(() => {
      socket.active = true;
    }),
    disconnect: vi.fn(() => {
      socket.active = false;
      socket.connected = false;
    }),
    emit: vi.fn(),
    on: (event: string, listener: AnyListener) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    off: (event: string, listener: AnyListener) => listeners.get(event)?.delete(listener),
    removeAllListeners: () => listeners.clear(),
  };
  const push = (event: string, payload?: unknown) => {
    for (const listener of Array.from(listeners.get(event) ?? [])) listener(payload);
  };
  const accept = () => {
    socket.connected = true;
    push('connect');
  };
  return { socket, push, accept };
}

function leaderAdapters(hub: ReturnType<typeof createFakeChannelHub>) {
  const transport = hub.transport();
  const adapters: LeaderElectionAdapters = {
    channel: createChannel<LeaderMessages>('test-leader', { transport }),
    storage: { getItem: () => null, setItem: () => {} },
    timers: {
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (handler, ms) => setInterval(handler, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    },
    clock: { now: () => Date.now() },
    random: () => 0.5,
    visibility: { isVisible: () => true, subscribe: () => () => {} },
  };
  return { adapters, transport };
}

function install(onResourceChanged = vi.fn()) {
  const hub = createFakeChannelHub();
  const { socket, push, accept } = fakeSocket();
  const { adapters, transport } = leaderAdapters(hub);
  const plugin = realtimePlugin({
    backend: MAIN_BACKEND,
    onResourceChanged,
    createSocket: () => socket as unknown as RealtimeSocket,
    leaderAdapters: adapters,
    controlTransport: transport,
  })({} as never);
  return { plugin, socket, push, accept, onResourceChanged };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  sessionStore.clear();
  vi.useRealTimers();
});

describe('realtimePlugin（docs/architecture/frontend/11-realtime.md §3）', () => {
  it('同步階段就建立連線物件並登記；onInit 後選上 leader 才連線', async () => {
    sessionStore.setTokens({ accessToken: 'token-1', expiresIn: 300 });
    const { plugin, socket } = install();

    expect(plugin.attrs?.realtime).toBe(getActiveRealtimeClient());
    void plugin.onInit?.();
    expect(socket.connect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CLAIM_WINDOW);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    plugin.onDestroy?.();
  });

  it('伺服器推來的變更交給注入的 onResourceChanged（可見分頁延遲後、要求重抓）', async () => {
    sessionStore.setTokens({ accessToken: 'token-1', expiresIn: 300 });
    const { plugin, push, accept, onResourceChanged } = install();
    void plugin.onInit?.();
    await vi.advanceTimersByTimeAsync(CLAIM_WINDOW);
    accept();
    expect(isRealtimeAvailable()).toBe(true);

    const change = { resource: 'user', kind: 'update', id: 'user-1' };
    push('resource.changed', { changes: [change], origin: 'other-tab' });
    await vi.advanceTimersByTimeAsync(JITTER_MAX);

    expect(onResourceChanged).toHaveBeenCalledWith([change], { refetch: true });
    plugin.onDestroy?.();
  });

  it('onDestroy 讓位、斷線並取消登記', async () => {
    sessionStore.setTokens({ accessToken: 'token-1', expiresIn: 300 });
    const { plugin, socket, push, onResourceChanged } = install();
    void plugin.onInit?.();
    await vi.advanceTimersByTimeAsync(CLAIM_WINDOW);

    plugin.onDestroy?.();
    push('resource.changed', { changes: [] });
    await vi.advanceTimersByTimeAsync(JITTER_MAX);

    expect(socket.disconnect).toHaveBeenCalled();
    expect(getActiveRealtimeClient()).toBeUndefined();
    expect(isRealtimeAvailable()).toBe(false);
    expect(onResourceChanged).not.toHaveBeenCalled();
  });
});
