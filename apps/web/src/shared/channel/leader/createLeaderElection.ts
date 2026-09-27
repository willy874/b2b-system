// 直接指向 createStore：`@/shared/store` 的 shareStore / syncStore 依賴 `@/shared/channel`，走 index 會形成循環。
import { createStore } from '@/shared/store/createStore';
import type { StoreApi } from '@/shared/store/createStore';

import { createChannel } from '../createChannel';
import type { Channel, ChannelOptions } from '../createChannel';
import { createInstanceId } from '../envelope';
import { compareLeaderTerm, isLeaderTerm, nextLeaderTerm } from './leaderTerm';
import type { LeaderTerm } from './leaderTerm';

/** 選舉協定的訊息。`createChannel` 已略過自己送出的訊息，這裡不必再比對 `instanceId`。 */
export type LeaderMessages = {
  /** 可見的分頁要求成為 leader；現任 leader 收到後讓位。 */
  'request-leader': { instanceId: string };
  'leader-announcement': { instanceId: string; term: LeaderTerm };
  'leader-heartbeat': { instanceId: string; term: LeaderTerm };
  /**
   * `yield`：讓給提出要求的分頁（被要走的一方可能進入 suspended）；
   * `shutdown`：分頁關閉或停止參與，所有可見分頁（含 suspended）都該接手。
   */
  'leader-release': { instanceId: string; term?: LeaderTerm; reason: 'yield' | 'shutdown' };
};

export type LeaderRole = 'leader' | 'follower';

export interface LeaderElectionState {
  role: LeaderRole;
  /** 目前已知的 leader 任期（自己是 leader 時就是自己的）。 */
  term: LeaderTerm | null;
  /** 目前活著的 leader（心跳未逾時）；沒有時為 `null`。 */
  leaderId: string | null;
  /**
   * 可見時被動失去 leader（另一個可見視窗要走了）：暫停競選，直到本分頁再次變為可見，
   * 或現任 leader 消失（關閉、心跳逾時）——那時沒有人在當 leader，暫停已經沒有意義。
   */
  isSuspended: boolean;
  /** 任期曾經走過 localStorage 不可用的退化路徑。 */
  degraded: boolean;
}

export interface LeaderElectionAdapters {
  channel: Channel<LeaderMessages>;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  timers: {
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    setInterval(handler: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
  };
  clock: { now(): number };
  /** `[0, 1)` */
  random: () => number;
  visibility: { isVisible(): boolean; subscribe(handler: () => void): () => void };
}

export interface LeaderElectionOptions {
  instanceId?: string;
  /** localStorage 裡單調 counter 的 key。 */
  counterKey: string;
  heartbeatInterval?: number;
  /** 超過這麼久沒收到心跳就視為 leader 已消失（分頁當掉、被系統凍結）。 */
  staleThreshold?: number;
  /** 競選前固定等待，讓現任 leader 有時間回應 `request-leader`；不得為 0。 */
  claimDelayBase?: number;
  /** 競選前的隨機延遲，錯開同時競選的分頁。 */
  claimDelayJitter?: number;
}

export interface LeaderElection {
  readonly instanceId: string;
  readonly state: StoreApi<LeaderElectionState>;
  isLeader(): boolean;
  /** 開始（或在 `stop()` 之後重新）參與選舉。 */
  start(): void;
  /** 讓出 leader、清掉計時器與監聽；頻道保留，可再 `start()`。 */
  stop(): void;
  /** `stop()` 並關閉頻道；之後 `start()` 無效。 */
  dispose(): void;
}

const INITIAL_STATE: LeaderElectionState = {
  role: 'follower',
  term: null,
  leaderId: null,
  isSuspended: false,
  degraded: false,
};

/**
 * 跨分頁的 leader 選舉（參考 fortes1219/socket-meetup-frontend 的 leader coordinator）。
 * 純引擎：只認 adapters，不知道 socket、快取或 React 的存在；計時、亂數、可見性、儲存都可注入。
 *
 * 規則（docs/architecture/frontend/11-realtime.md §3.3）：
 * - **可見的分頁才競選**：加入或變為可見時送 `request-leader`，等 `claimDelay` 沒人回應就自己當選。
 * - 現任 leader 收到 `request-leader` 就讓位（`leader-release`）。分頁只是進背景 **不** 主動讓位，
 *   避免背景作業時連線無故中斷；要等另一個可見分頁來要。
 * - 可見時被動讓位（兩個視窗並排）→ `isSuspended`，不立刻搶回，避免兩個視窗互搶；
 *   本分頁下次變為可見時才重新競選。與參考實作不同：leader **關閉或逾時** 時解除暫停，
 *   否則並排的另一個視窗會一直沒有 leader，直到使用者點它（參考實作靠 UI 的「恢復」按鈕）。
 * - leader 每 `heartbeatInterval` 送心跳；超過 `staleThreshold` 沒收到，可見的分頁重新競選。
 * - 任期（`LeaderTerm`）單調遞增，同時當選時較新的任期勝出，較舊的一方安靜退位。
 */
export function createLeaderElection(
  adapters: LeaderElectionAdapters,
  options: LeaderElectionOptions,
): LeaderElection {
  const { channel, storage, timers, clock, random, visibility } = adapters;
  const heartbeatInterval = options.heartbeatInterval ?? 1000;
  const staleThreshold = options.staleThreshold ?? 3000;
  const claimDelayBase = options.claimDelayBase ?? 200;
  const claimDelayJitter = options.claimDelayJitter ?? 200;
  const instanceId = options.instanceId ?? createInstanceId();

  const state = createStore<LeaderElectionState>(() => ({ ...INITIAL_STATE }));
  const set = (partial: Partial<LeaderElectionState>) => state.setState(partial);
  const get = () => state.getState();

  let lastSeenCounter = 0;
  let lastHeartbeatAt: number | null = null;
  let knownTerm: LeaderTerm | null = null;
  let claimHandle: unknown = null;
  let heartbeatHandle: unknown = null;
  let staleHandle: unknown = null;
  let offs: (() => void)[] = [];
  let started = false;
  let disposed = false;

  function rememberTerm(term: LeaderTerm): void {
    lastSeenCounter = Math.max(lastSeenCounter, term.counter);
    if (!knownTerm || compareLeaderTerm(term, knownTerm) > 0) knownTerm = term;
  }

  function clearClaim(): void {
    if (claimHandle === null) return;
    timers.clearTimeout(claimHandle);
    claimHandle = null;
  }

  function stopHeartbeat(): void {
    if (heartbeatHandle === null) return;
    timers.clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  }

  function stopStale(): void {
    if (staleHandle === null) return;
    timers.clearTimeout(staleHandle);
    staleHandle = null;
  }

  function resetStale(): void {
    stopStale();
    staleHandle = timers.setTimeout(() => {
      staleHandle = null;
      lastHeartbeatAt = null;
      set({ leaderId: null, isSuspended: false });
      if (visibility.isVisible()) scheduleClaim();
    }, staleThreshold);
  }

  function scheduleClaim(): void {
    clearClaim();
    if (get().isSuspended || !visibility.isVisible()) return;
    claimHandle = timers.setTimeout(
      () => {
        claimHandle = null;
        attemptClaim();
      },
      claimDelayBase + random() * claimDelayJitter,
    );
  }

  function hasFreshOtherLeader(): boolean {
    return (
      lastHeartbeatAt !== null &&
      knownTerm !== null &&
      knownTerm.ownerId !== instanceId &&
      clock.now() - lastHeartbeatAt < staleThreshold
    );
  }

  function attemptClaim(): void {
    if (get().isSuspended || !visibility.isVisible()) return;
    if (hasFreshOtherLeader()) becomeFollower();
    else becomeLeader();
  }

  function becomeLeader(): void {
    const result = nextLeaderTerm(
      { storage, now: () => clock.now() },
      options.counterKey,
      instanceId,
      lastSeenCounter,
    );
    const { term } = result;
    lastSeenCounter = Math.max(lastSeenCounter, term.counter);
    knownTerm = term;
    stopStale();
    set({
      role: 'leader',
      term,
      leaderId: instanceId,
      degraded: get().degraded || result.degraded,
    });
    channel.post('leader-announcement', { instanceId, term });
    startHeartbeat(term);
  }

  function startHeartbeat(term: LeaderTerm): void {
    stopHeartbeat();
    channel.post('leader-heartbeat', { instanceId, term });
    heartbeatHandle = timers.setInterval(() => {
      const current = get();
      if (current.role === 'leader' && current.term) {
        channel.post('leader-heartbeat', { instanceId, term: current.term });
      }
    }, heartbeatInterval);
  }

  function becomeFollower(): void {
    stopHeartbeat();
    set({
      role: 'follower',
      term: knownTerm,
      leaderId: hasFreshOtherLeader() && knownTerm ? knownTerm.ownerId : null,
    });
    resetStale();
  }

  function handleRequestLeader(): void {
    const current = get();
    if (current.role !== 'leader' || !current.term) return;
    // 自己仍可見卻被要走：兩個視窗並排。暫停競選，否則兩邊會互搶
    if (visibility.isVisible()) set({ isSuspended: true });
    channel.post('leader-release', { instanceId, term: current.term, reason: 'yield' });
    lastHeartbeatAt = null;
    becomeFollower();
  }

  function handleLeaderSignal({ term }: { term: unknown }): void {
    if (!isLeaderTerm(term)) return;
    rememberTerm(term);
    lastHeartbeatAt = clock.now();
    clearClaim();

    const current = get();
    if (current.role !== 'leader' || !current.term) {
      becomeFollower();
      return;
    }
    // 自己也是 leader：任期較舊的一方安靜退位（新 leader 已經宣告過了）
    if (compareLeaderTerm(term, current.term) <= 0) return;
    if (visibility.isVisible()) set({ isSuspended: true });
    becomeFollower();
  }

  function handleLeaderRelease({ term, reason }: { term?: unknown; reason?: unknown }): void {
    if (isLeaderTerm(term)) rememberTerm(term);
    lastHeartbeatAt = null;
    set(reason === 'shutdown' ? { leaderId: null, isSuspended: false } : { leaderId: null });
    if (visibility.isVisible()) scheduleClaim();
  }

  function onVisibilityChange(): void {
    if (!visibility.isVisible()) {
      // 進背景不讓位：單一分頁的背景作業仍保有連線；其他可見分頁會來要
      clearClaim();
      return;
    }
    // 回到前景：重新參與競選，並補上隱藏期間可能錯過的任期變動
    set({ isSuspended: false });
    channel.post('request-leader', { instanceId });
    const current = get();
    if (
      current.role === 'leader' &&
      current.term &&
      knownTerm &&
      compareLeaderTerm(knownTerm, current.term) > 0
    ) {
      becomeFollower();
      return;
    }
    if (current.role !== 'leader' && !hasFreshOtherLeader()) scheduleClaim();
  }

  function stop(): void {
    if (!started) return;
    started = false;
    const current = get();
    if (current.role === 'leader' && current.term) {
      channel.post('leader-release', { instanceId, term: current.term, reason: 'shutdown' });
    }
    clearClaim();
    stopHeartbeat();
    stopStale();
    for (const off of offs.splice(0)) off();
    lastHeartbeatAt = null;
    knownTerm = null;
    set({ ...INITIAL_STATE, degraded: current.degraded });
  }

  return {
    instanceId,
    state,
    isLeader: () => get().role === 'leader',
    stop,

    start() {
      if (disposed || started) return;
      started = true;
      offs = [
        channel.on('request-leader', handleRequestLeader),
        channel.on('leader-announcement', handleLeaderSignal),
        channel.on('leader-heartbeat', handleLeaderSignal),
        channel.on('leader-release', handleLeaderRelease),
        visibility.subscribe(onVisibilityChange),
      ];
      if (visibility.isVisible()) {
        channel.post('request-leader', { instanceId });
        scheduleClaim();
      } else {
        resetStale();
      }
    },

    dispose() {
      if (disposed) return;
      stop();
      channel.close();
      disposed = true;
    },
  };
}

/** 選舉頻道：由 `LeaderElection` 持有（經 `adapters.channel` 交給它，`dispose()` 時關閉）。 */
export function createLeaderChannel(
  name: string,
  options?: ChannelOptions,
): Channel<LeaderMessages> {
  return createChannel(`leader:${name}`, options);
}

/** 分頁關閉時的正常讓位由 `stop()` 處理；當掉或被凍結的分頁由心跳逾時接手。 */
export function browserLeaderAdapters(name: string): LeaderElectionAdapters {
  return {
    channel: createLeaderChannel(name),
    storage: {
      // 隱私模式可能直接拋錯；`nextLeaderTerm` 會接住並改走退化路徑
      getItem: (key) => globalThis.localStorage.getItem(key),
      setItem: (key, value) => globalThis.localStorage.setItem(key, value),
    },
    timers: {
      setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
      clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
    },
    clock: { now: () => Date.now() },
    random: Math.random,
    visibility: {
      isVisible: () => globalThis.document?.visibilityState !== 'hidden',
      subscribe: (handler) => {
        globalThis.document?.addEventListener('visibilitychange', handler);
        return () => globalThis.document?.removeEventListener('visibilitychange', handler);
      },
    },
  };
}
