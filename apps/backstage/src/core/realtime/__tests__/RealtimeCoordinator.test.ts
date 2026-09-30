import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChannel, createLeaderElection } from '@/shared/channel';
import type { LeaderElectionAdapters, LeaderMessages } from '@/shared/channel';
import { EventEmitter } from '@/shared/EventEmitter';
import type { ResourceChangeWire } from '@/shared/websocket-sdk';
import { createFakeChannelHub } from '@/test/fakeChannelHub';

import { RealtimeClientEvent } from '../RealtimeClient';
import type { RealtimeClient, RealtimeClientEvents } from '../RealtimeClient';
import { RealtimeCoordinator } from '../RealtimeCoordinator';
import type { ApplyOptions, RealtimeControlMessages } from '../RealtimeCoordinator';

const CLAIM_WINDOW = 401;
const STALE = 3000;
const JITTER = 100;

type Hub = ReturnType<typeof createFakeChannelHub>;

/** RealtimeClient 在協調者眼中的樣子：擁有權、連線狀態、事件。 */
class FakeClient {
  readonly events = new EventEmitter<RealtimeClientEvents>();
  isConnected = false;
  isOwner = true;
  private hasConnectedBefore = false;

  readonly setOwner = vi.fn((owner: boolean) => {
    this.isOwner = owner;
    if (!owner && this.isConnected) this.drop();
  });

  /** 伺服器接受 handshake。 */
  accept(): void {
    this.isConnected = true;
    const resumed = this.hasConnectedBefore;
    this.hasConnectedBefore = true;
    this.events.emit(RealtimeClientEvent.CONNECTED, { resumed });
  }

  drop(): void {
    this.isConnected = false;
    this.events.emit(RealtimeClientEvent.DISCONNECTED);
  }

  push(changes: ResourceChangeWire[], origin?: string): void {
    this.events.emit(
      RealtimeClientEvent.RESOURCE_CHANGED,
      origin === undefined ? { changes } : { changes, origin },
    );
  }
}

interface Tab {
  id: string;
  client: FakeClient;
  coordinator: RealtimeCoordinator;
  applied: { changes: readonly ResourceChangeWire[]; options: ApplyOptions }[];
  resynced: ApplyOptions[];
  setVisible(visible: boolean): void;
  transport: ReturnType<Hub['transport']>;
}

const coordinators: RealtimeCoordinator[] = [];
let storage: Map<string, string>;

function openTab(hub: Hub, { visible = true } = {}): Tab {
  const id = `tab-${coordinators.length + 1}`;
  let isVisible = visible;
  const handlers = new Set<() => void>();
  const visibility = {
    isVisible: () => isVisible,
    subscribe: (handler: () => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
  const transport = hub.transport();
  const adapters: LeaderElectionAdapters = {
    channel: createChannel<LeaderMessages>('test-leader', { transport }),
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
    },
    timers: {
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (handler, ms) => setInterval(handler, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    },
    clock: { now: () => Date.now() },
    random: () => 0.5,
    visibility,
  };
  const client = new FakeClient();
  const applied: Tab['applied'] = [];
  const resynced: ApplyOptions[] = [];
  const coordinator = new RealtimeCoordinator({
    client: client as unknown as RealtimeClient,
    election: createLeaderElection(adapters, {
      counterKey: 'test:counter',
      instanceId: id,
      staleThreshold: STALE,
    }),
    channel: createChannel<RealtimeControlMessages>('test-control', { transport }),
    clientId: id,
    applyChanges: (changes, options) => applied.push({ changes, options }),
    resync: (options) => resynced.push(options),
    visibility,
    jitter: { min: JITTER, max: JITTER },
  });
  coordinators.push(coordinator);
  coordinator.start();
  return {
    id,
    client,
    coordinator,
    applied,
    resynced,
    transport,
    setVisible(next) {
      isVisible = next;
      for (const handler of handlers) handler();
    },
  };
}

const change = (id: string): ResourceChangeWire => ({ resource: 'role', kind: 'update', id });

/**
 * 兩個分頁，`a` 是已連上的 leader，`b` 是 follower。
 * - 預設 `b` 在背景（切到別的分頁）。
 * - `followerVisible`：兩個視窗並排——`b` 先開、`a` 後開並要走 leader，`b` 成為可見但暫停競選的 follower
 *  （最新變為可見的分頁當 leader，這是設計）。
 */
function leaderAndFollower(hub: Hub, { followerVisible = false } = {}) {
  const b = openTab(hub, { visible: followerVisible });
  if (followerVisible) vi.advanceTimersByTime(CLAIM_WINDOW);
  const a = openTab(hub);
  vi.advanceTimersByTime(CLAIM_WINDOW);
  a.client.accept();
  vi.advanceTimersByTime(1);
  return { a, b };
}

beforeEach(() => {
  vi.useFakeTimers();
  storage = new Map();
});

afterEach(() => {
  for (const coordinator of coordinators.splice(0)) coordinator.dispose();
  vi.useRealTimers();
});

describe('RealtimeCoordinator：連線擁有權（docs/architecture/frontend/11-realtime.md §3.3）', () => {
  it('只有 leader 分頁持有連線；follower 交出擁有權', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub);

    expect(a.client.isOwner).toBe(true);
    expect(b.client.isOwner).toBe(false);
  });

  it('選出 leader 之前不連線', () => {
    const hub = createFakeChannelHub();
    const a = openTab(hub);

    expect(a.client.setOwner).toHaveBeenCalledWith(false);
    expect(a.client.isOwner).toBe(false);
  });

  it('leader 讓位（切換到另一個分頁）→ 舊 leader 斷線，新 leader 取得擁有權', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub);

    a.setVisible(false);
    b.setVisible(true);
    vi.advanceTimersByTime(CLAIM_WINDOW);

    expect(a.client.isOwner).toBe(false);
    expect(a.client.isConnected).toBe(false);
    expect(b.client.isOwner).toBe(true);
  });
});

describe('RealtimeCoordinator：轉發來源變更（§3.4、§4）', () => {
  it('leader 收到的變更轉給 follower；可見分頁延遲後套用並重抓', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub, { followerVisible: true });

    a.client.push([change('r1')], 'someone-else');
    vi.advanceTimersByTime(JITTER + 1);

    expect(a.applied).toEqual([{ changes: [change('r1')], options: { refetch: true } }]);
    expect(b.applied).toEqual([{ changes: [change('r1')], options: { refetch: true } }]);
  });

  it('origin 是 leader 自己：leader 不套用（mutation 已失效過），但仍轉給 follower', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub, { followerVisible: true });

    a.client.push([change('r1')], a.id);
    vi.advanceTimersByTime(JITTER + 1);

    expect(a.applied).toEqual([]);
    expect(b.applied).toHaveLength(1);
  });

  it('origin 是 follower：發起的 follower 不套用，leader 套用', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub, { followerVisible: true });

    a.client.push([change('r1')], b.id);
    vi.advanceTimersByTime(JITTER + 1);

    expect(a.applied).toHaveLength(1);
    expect(b.applied).toEqual([]);
  });

  it('背景分頁立刻只標 stale（refetch: false），不等延遲、不重抓', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub);

    a.client.push([change('r1')]);
    vi.advanceTimersByTime(1);

    expect(b.applied).toEqual([{ changes: [change('r1')], options: { refetch: false } }]);
  });

  it('可見分頁把延遲期間連續收到的變更合併成一次套用（削峰）', () => {
    const hub = createFakeChannelHub();
    const { a } = leaderAndFollower(hub);

    a.client.push([change('r1')]);
    a.client.push([change('r2')]);
    vi.advanceTimersByTime(JITTER + 1);

    expect(a.applied).toEqual([
      { changes: [change('r1'), change('r2')], options: { refetch: true } },
    ]);
  });

  it('follower 發現序號跳號（漏收）→ 不套用那一筆，改為整批重新驗證', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub);
    // 以 leader 的任期直接送序號 1 與 3：模擬第 2 筆在途中遺失
    const { term } = a.coordinator['options'].election.state.getState();
    const relay = createChannel<RealtimeControlMessages>('test-control', {
      transport: hub.transport(),
    });

    relay.post('resource-changed', { term: term!, sequence: 1, changes: [change('r1')] });
    relay.post('resource-changed', { term: term!, sequence: 3, changes: [change('r3')] });
    relay.close();
    vi.advanceTimersByTime(1);

    expect(b.applied.map((entry) => entry.changes)).toEqual([[change('r1')]]);
    expect(b.resynced).toEqual([{ refetch: false }]);
  });

  it('重複送達（同一序號）只處理一次', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub);
    const { term } = a.coordinator['options'].election.state.getState();
    const relay = createChannel<RealtimeControlMessages>('test-control', {
      transport: hub.transport(),
    });

    relay.post('resource-changed', { term: term!, sequence: 1, changes: [change('r1')] });
    relay.post('resource-changed', { term: term!, sequence: 1, changes: [change('r1')] });
    relay.close();
    vi.advanceTimersByTime(1);

    expect(b.applied).toHaveLength(1);
  });

  it('舊任期的轉發被丟掉', () => {
    const hub = createFakeChannelHub();
    const { b } = leaderAndFollower(hub);
    const forged = createChannel<RealtimeControlMessages>('test-control', {
      transport: hub.transport(),
    });

    forged.post('resource-changed', {
      term: { counter: 0, ownerId: 'ancient' },
      sequence: 1,
      changes: [change('old')],
    });
    forged.close();
    vi.advanceTimersByTime(1);

    expect(b.applied).toEqual([]);
  });

  it('其他分頁送來看不懂的變更（新舊版本並存）→ 整批重新驗證', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub);
    const { term } = a.coordinator['options'].election.state.getState();
    const forged = createChannel<RealtimeControlMessages>('test-control', {
      transport: hub.transport(),
    });

    forged.post('resource-changed', {
      term: term!,
      sequence: 1,
      changes: [{ resource: 'unknown-resource' } as never],
    });
    forged.close();
    vi.advanceTimersByTime(1);

    expect(b.applied).toEqual([]);
    expect(b.resynced).toEqual([{ refetch: false }]);
  });
});

describe('RealtimeCoordinator：推播中斷後的補償（§5）', () => {
  it('唯一的分頁第一次連上：不重新驗證', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub);
    vi.advanceTimersByTime(JITTER + 1);

    expect(a.resynced).toEqual([]);
    expect(b.resynced).toEqual([]);
  });

  it('leader 重新連上（中間斷過）→ 廣播 resync，所有分頁重新驗證', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub);

    a.client.drop();
    a.client.accept();
    vi.advanceTimersByTime(JITTER + 1);

    expect(a.resynced).toEqual([{ refetch: true }]);
    expect(b.resynced).toEqual([{ refetch: false }]);
  });

  it('leader 交接：新 leader 第一次連上就廣播 resync（交接空窗可能漏了推播）', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub);

    a.setVisible(false);
    b.setVisible(true);
    vi.advanceTimersByTime(CLAIM_WINDOW);
    b.client.accept();
    vi.advanceTimersByTime(JITTER + 1);

    expect(b.resynced).toEqual([{ refetch: true }]);
    expect(a.resynced).toEqual([{ refetch: false }]);
  });
});

describe('RealtimeCoordinator：推播是否可用（§4.2）', () => {
  it('leader 看自己的連線；follower 看 leader 回報的狀態', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub);

    expect(a.coordinator.isAvailable()).toBe(true);
    expect(b.coordinator.isAvailable()).toBe(true);

    a.client.drop();
    vi.advanceTimersByTime(1);
    expect(a.coordinator.isAvailable()).toBe(false);
    expect(b.coordinator.isAvailable()).toBe(false);
  });

  it('新分頁加入時問得到 leader 目前的連線狀態', () => {
    const hub = createFakeChannelHub();
    const { a } = leaderAndFollower(hub);

    const late = openTab(hub, { visible: false });
    vi.advanceTimersByTime(1_001); // 等一次心跳，知道 leader 是誰

    expect(a.coordinator.isAvailable()).toBe(true);
    expect(late.coordinator.isAvailable()).toBe(true);
  });

  it('leader 當掉（心跳逾時）→ follower 視為不可用（mutation 改回經本機頻道廣播）', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub);

    hub.isolate(a.transport);
    vi.advanceTimersByTime(STALE + 1);

    expect(b.coordinator.isAvailable()).toBe(false);
  });

  it('stop（分頁關閉）→ 讓位並斷線，可見的其他分頁接手', () => {
    const hub = createFakeChannelHub();
    const { a, b } = leaderAndFollower(hub, { followerVisible: true });
    // b 在並排情境下被要走而進入 suspended；leader 關閉時仍要接手
    a.coordinator.stop();
    vi.advanceTimersByTime(CLAIM_WINDOW);

    expect(a.client.isOwner).toBe(false);
    expect(b.client.isOwner).toBe(true);
  });
});
