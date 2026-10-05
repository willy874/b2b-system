import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeChannelHub } from '../../testing';
import { createChannel } from '../createChannel';
import { createLeaderElection } from '../leader/createLeaderElection';
import type { LeaderElection, LeaderMessages } from '../leader/createLeaderElection';

const COUNTER_KEY = 'test:leader:counter';
const HEARTBEAT = 1000;
const STALE = 3000;
const CLAIM_BASE = 200;
const CLAIM_JITTER = 200;
/** 一定比任何一次競選延遲都長。 */
const CLAIM_WINDOW = CLAIM_BASE + CLAIM_JITTER + 1;

type Hub = ReturnType<typeof createFakeChannelHub>;

interface Tab {
  election: LeaderElection;
  setVisible(visible: boolean): void;
  transport: ReturnType<Hub['transport']>;
}

let storage: Map<string, string>;
const elections: LeaderElection[] = [];

/** 每次呼叫代表一個分頁；同一個 hub 的分頁彼此看得到。 */
function openTab(hub: Hub, { visible = true, storageThrows = false, id = '' } = {}): Tab {
  let isVisible = visible;
  const handlers = new Set<() => void>();
  const transport = hub.transport();
  const election = createLeaderElection(
    {
      channel: createChannel<LeaderMessages>('test-leader', { transport }),
      storage: {
        getItem: (key) => {
          if (storageThrows) throw new Error('storage disabled');
          return storage.get(key) ?? null;
        },
        setItem: (key, value) => {
          if (storageThrows) throw new Error('storage disabled');
          storage.set(key, value);
        },
      },
      timers: {
        setTimeout: (handler, ms) => setTimeout(handler, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        setInterval: (handler, ms) => setInterval(handler, ms),
        clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
      },
      clock: { now: () => Date.now() },
      random: () => 0.5,
      visibility: {
        isVisible: () => isVisible,
        subscribe: (handler) => {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
      },
    },
    {
      counterKey: COUNTER_KEY,
      heartbeatInterval: HEARTBEAT,
      staleThreshold: STALE,
      claimDelayBase: CLAIM_BASE,
      claimDelayJitter: CLAIM_JITTER,
      ...(id ? { instanceId: id } : {}),
    },
  );
  elections.push(election);
  election.start();
  return {
    election,
    transport,
    setVisible(next) {
      isVisible = next;
      for (const handler of handlers) handler();
    },
  };
}

const roleOf = (tab: Tab) => tab.election.state.getState().role;

beforeEach(() => {
  vi.useFakeTimers();
  storage = new Map();
});

afterEach(() => {
  for (const election of elections.splice(0)) election.dispose();
  vi.useRealTimers();
});

describe('createLeaderElection（跨分頁 leader 選舉）', () => {
  it('唯一的可見分頁在競選延遲後成為 leader', () => {
    const hub = createFakeChannelHub();
    const a = openTab(hub);

    expect(roleOf(a)).toBe('follower');
    vi.advanceTimersByTime(CLAIM_WINDOW);

    expect(roleOf(a)).toBe('leader');
    expect(a.election.state.getState().leaderId).toBe(a.election.instanceId);
  });

  it('切換分頁：新的可見分頁要走 leader，背景的舊 leader 讓位（不進入 suspended）', () => {
    const hub = createFakeChannelHub();
    const a = openTab(hub);
    vi.advanceTimersByTime(CLAIM_WINDOW);

    a.setVisible(false);
    const b = openTab(hub);
    vi.advanceTimersByTime(CLAIM_WINDOW);

    expect(roleOf(a)).toBe('follower');
    expect(a.election.state.getState().isSuspended).toBe(false);
    expect(roleOf(b)).toBe('leader');
    expect(a.election.state.getState().leaderId).toBe(b.election.instanceId);
  });

  it('兩個視窗並排（都可見）：被要走的一方進入 suspended，不會馬上搶回', () => {
    const hub = createFakeChannelHub();
    const a = openTab(hub);
    vi.advanceTimersByTime(CLAIM_WINDOW);

    const b = openTab(hub);
    vi.advanceTimersByTime(CLAIM_WINDOW + STALE * 2);

    expect(roleOf(b)).toBe('leader');
    expect(roleOf(a)).toBe('follower');
    expect(a.election.state.getState().isSuspended).toBe(true);
  });

  it('並排時 suspended 的視窗：leader 當掉（心跳逾時）後解除暫停並接手', () => {
    const hub = createFakeChannelHub();
    const a = openTab(hub);
    vi.advanceTimersByTime(CLAIM_WINDOW);
    const b = openTab(hub);
    vi.advanceTimersByTime(CLAIM_WINDOW);
    expect(a.election.state.getState().isSuspended).toBe(true);

    hub.isolate(b.transport);
    vi.advanceTimersByTime(STALE + CLAIM_WINDOW);

    expect(roleOf(a)).toBe('leader');
    expect(a.election.state.getState().isSuspended).toBe(false);
  });

  it('隱藏的分頁加入時不競選，只當 follower', () => {
    const hub = createFakeChannelHub();
    const a = openTab(hub);
    vi.advanceTimersByTime(CLAIM_WINDOW);

    const hidden = openTab(hub, { visible: false });
    vi.advanceTimersByTime(CLAIM_WINDOW + HEARTBEAT);

    expect(roleOf(a)).toBe('leader');
    expect(roleOf(hidden)).toBe('follower');
    expect(hidden.election.state.getState().leaderId).toBe(a.election.instanceId);
  });

  it('leader 進背景不讓位：沒有其他可見分頁來要時繼續當 leader', () => {
    const hub = createFakeChannelHub();
    const a = openTab(hub);
    vi.advanceTimersByTime(CLAIM_WINDOW);

    a.setVisible(false);
    vi.advanceTimersByTime(STALE * 3);

    expect(roleOf(a)).toBe('leader');
  });

  it('leader 當掉（心跳中斷）→ 可見的 follower 在逾時後接手', () => {
    const hub = createFakeChannelHub();
    const a = openTab(hub);
    vi.advanceTimersByTime(CLAIM_WINDOW);
    const b = openTab(hub, { visible: false });
    vi.advanceTimersByTime(HEARTBEAT);
    b.setVisible(true); // 會要走 leader；先讓 a 當掉，模擬沒人回應
    hub.isolate(a.transport);

    vi.advanceTimersByTime(STALE + CLAIM_WINDOW);

    expect(roleOf(b)).toBe('leader');
  });

  it('leader 正常關閉（stop）→ 送出讓位，可見的 follower 不必等逾時就接手', () => {
    const hub = createFakeChannelHub();
    const a = openTab(hub, { visible: false });
    const b = openTab(hub);
    vi.advanceTimersByTime(CLAIM_WINDOW);
    expect(roleOf(b)).toBe('leader');

    a.setVisible(true);
    vi.advanceTimersByTime(CLAIM_WINDOW);
    expect(roleOf(a)).toBe('leader');
    a.election.stop();
    vi.advanceTimersByTime(CLAIM_WINDOW);

    expect(roleOf(b)).toBe('leader');
    expect(hub.sentOfType('leader-release').length).toBeGreaterThan(0);
  });

  it('同時當選（訊息延遲超過競選延遲）→ 任期較舊的一方退位，最後只剩一個 leader', () => {
    const hub = createFakeChannelHub({ latency: CLAIM_WINDOW * 2 });
    const a = openTab(hub, { id: 'tab-a' });
    const b = openTab(hub, { id: 'tab-b' });

    vi.advanceTimersByTime(CLAIM_WINDOW);
    expect([roleOf(a), roleOf(b)]).toEqual(['leader', 'leader']);

    vi.advanceTimersByTime(CLAIM_WINDOW * 4);
    const leaders = [a, b].filter((tab) => roleOf(tab) === 'leader');
    expect(leaders).toHaveLength(1);
    // localStorage 的單調 counter：後當選的任期較新
    expect(leaders[0]).toBe(b);
  });

  it('localStorage 不可用 → 走退化路徑仍能當選，並標記 degraded', () => {
    const hub = createFakeChannelHub();
    const a = openTab(hub, { storageThrows: true });
    vi.advanceTimersByTime(CLAIM_WINDOW);

    expect(roleOf(a)).toBe('leader');
    expect(a.election.state.getState().degraded).toBe(true);
  });

  it('dispose 之後 start 無效', () => {
    const hub = createFakeChannelHub();
    const a = openTab(hub);
    a.election.dispose();
    a.election.start();
    vi.advanceTimersByTime(CLAIM_WINDOW);

    expect(roleOf(a)).toBe('follower');
  });
});
