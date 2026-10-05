import { ResourceChangeWireSchema } from '@b2b-system/realtime';
import type { ResourceChanged, ResourceChangeWire } from '@b2b-system/realtime';
import { compareLeaderTerm, createChannel, isLeaderTerm } from '@b2b-system/web-shared/channel';
import type {
  Channel,
  ChannelOptions,
  LeaderElection,
  LeaderElectionState,
  LeaderTerm,
} from '@b2b-system/web-shared/channel';
import { createKeyedThrottle } from '@b2b-system/web-shared/utils';
import type { JitterRange, KeyedThrottle } from '@b2b-system/web-shared/utils';

import { RealtimeClientEvent } from './RealtimeClient';
import type { RealtimeClient } from './RealtimeClient';

/**
 * 分頁之間的 control plane（BroadcastChannel）。只傳低頻的協調訊號，不傳資料本體，
 * 也不傳高頻事件（docs/architecture/frontend/11-realtime.md §3.4）。
 */
export type RealtimeControlMessages = {
  /** leader 轉發伺服器推來的來源變更。`sequence` 在同一任期內從 1 遞增，用來發現漏收。 */
  'resource-changed': {
    term: LeaderTerm;
    sequence: number;
    changes: ResourceChangeWire[];
    origin?: string;
  };
  /** 推播曾經中斷（重連、leader 交接）：所有分頁整批重新驗證。 */
  resync: { term: LeaderTerm };
  /** leader 的連線狀態：follower 據此判斷「推播是否可用」。 */
  status: { term: LeaderTerm; connected: boolean };
  /** 新分頁加入時詢問目前 leader 的連線狀態。 */
  'status-request': Record<string, never>;
};

/** 某個後端的 control channel：由 `RealtimeCoordinator` 持有。 */
export function createRealtimeControlChannel(
  backend: string,
  options?: ChannelOptions,
): Channel<RealtimeControlMessages> {
  return createChannel(`realtime-control:${backend}`, options);
}

export interface ApplyOptions {
  /** `false`：只標成 stale、不立刻重抓（背景分頁；回到前景時由 TanStack 的 focus refetch 接手）。 */
  refetch: boolean;
}

export interface RealtimeCoordinatorOptions {
  client: RealtimeClient;
  election: LeaderElection;
  /** `createRealtimeControlChannel(backend)`；交給協調者後由它負責關閉（`dispose()`）。 */
  channel: Channel<RealtimeControlMessages>;
  /** 本分頁的 instance id（`x-client-id`）：推播的 `origin` 是自己就不在本分頁套用。 */
  clientId: string;
  /** 來源變更 → 本分頁失效（由 `main.tsx` 注入依賴圖換算）。 */
  applyChanges: (changes: readonly ResourceChangeWire[], options: ApplyOptions) => void;
  /** 整批重新驗證本分頁的 query。 */
  resync: (options: ApplyOptions) => void;
  visibility: { isVisible(): boolean };
  /** 可見分頁套用前的隨機延遲：同一筆寫入推給所有線上使用者時，把重抓攤開。 */
  jitter?: JitterRange;
  throttle?: KeyedThrottle;
}

/** 預設的套用延遲：短到使用者察覺不到，長到足以合併同一批寫入、攤開多人同時重抓。 */
export const DEFAULT_APPLY_JITTER: JitterRange = { min: 150, max: 750 };

const APPLY_KEY = 'apply';

/**
 * 推播的「單一連線、多分頁共享」協調（參考 fortes1219/socket-meetup-frontend 的
 * control coordinator；docs/architecture/frontend/11-realtime.md §3.3、§3.4）。
 *
 * - **只有 leader 分頁持有 Socket.io 連線**；follower 沒有連線，經 control channel 收到 leader 轉發的變更。
 * - 轉發的是 **來源變更**（低頻訊號），不是資料；每個分頁用自己的依賴圖換算、自己重抓。
 * - `term` ＋ `sequence`：丟掉舊任期與重複的訊息；發現漏收（序號跳號）就整批重新驗證。
 * - leader 交接或重連時，中間的推播已遺失 → 新 leader 廣播 `resync`。
 * - 背景分頁只標 stale 不重抓；可見分頁以隨機延遲合併後才重抓（削峰）。
 */
export class RealtimeCoordinator {
  private readonly options: RealtimeCoordinatorOptions;
  private readonly throttle: KeyedThrottle;
  private readonly jitter: JitterRange;
  private readonly offs: (() => void)[] = [];
  private readonly availabilityListeners = new Set<() => void>();

  /** leader：本任期已送出的序號。 */
  private sequence = 0;
  /** leader：下一次連上時要廣播 `resync`（交接或重連，中間可能漏了推播）。 */
  private resyncOnConnect = false;
  /** follower：目前採信的任期與已套用的序號。 */
  private knownTerm: LeaderTerm | null = null;
  private lastSequence = 0;
  /** follower：目前 leader 的連線狀態。 */
  private leaderStatus: { term: LeaderTerm; connected: boolean } | null = null;
  /** 可見分頁延遲套用前累積的變更。 */
  private buffered: ResourceChangeWire[] = [];
  private bufferedResync = false;
  private wasLeader = false;
  private started = false;

  constructor(options: RealtimeCoordinatorOptions) {
    this.options = options;
    this.jitter = options.jitter ?? DEFAULT_APPLY_JITTER;
    this.throttle = options.throttle ?? createKeyedThrottle();
  }

  /**
   * 推播是否可用：本分頁是 leader 且連線中，或已知的 leader 回報連線中。
   * 可用時其他分頁會收到同一筆變更，`broadcastInvalidation` 不必再經本機頻道廣播。
   */
  isAvailable(): boolean {
    const { election, client } = this.options;
    if (election.isLeader()) return client.isConnected;
    const { leaderId } = election.state.getState();
    const status = this.leaderStatus;
    return Boolean(status?.connected && leaderId !== null && status.term.ownerId === leaderId);
  }

  /** 可用性改變時通知（供 `useSyncExternalStore` 或除錯面板）。 */
  subscribe(listener: () => void): () => void {
    this.availabilityListeners.add(listener);
    return () => this.availabilityListeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const { client, election, channel } = this.options;

    // 先交出擁有權：選出來之前不連線
    client.setOwner(false);
    this.offs.push(
      election.state.subscribe((state, previous) => this.handleElection(state, previous)),
      client.events.on(RealtimeClientEvent.CONNECTED, this.handleConnected),
      client.events.on(RealtimeClientEvent.DISCONNECTED, this.handleDisconnected),
      client.events.on(RealtimeClientEvent.RESOURCE_CHANGED, this.handleServerChanges),
      channel.on('resource-changed', this.handleRelayedChanges),
      channel.on('resync', this.handleResync),
      channel.on('status', this.handleStatus),
      channel.on('status-request', this.handleStatusRequest),
    );
    election.start();
    channel.post('status-request', {});
  }

  /** 讓出 leader（通知其他分頁接手）、斷線、清掉排程；可再 `start()`。 */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    for (const off of this.offs.splice(0)) off();
    this.throttle.stop();
    this.buffered = [];
    this.bufferedResync = false;
    this.options.election.stop();
    this.options.client.setOwner(false);
    this.wasLeader = false;
    this.leaderStatus = null;
    this.notify();
  }

  dispose(): void {
    this.stop();
    this.options.election.dispose();
    this.options.channel.close();
    this.availabilityListeners.clear();
  }

  // ── 選舉 ───────────────────────────────────────────────

  private handleElection(state: LeaderElectionState, previous: LeaderElectionState): void {
    const isLeader = state.role === 'leader';
    if (isLeader !== this.wasLeader) {
      this.wasLeader = isLeader;
      if (isLeader) {
        this.sequence = 0;
        // 之前有別的 leader：交接的空窗裡可能漏了推播
        this.resyncOnConnect =
          previous.term !== null && previous.term.ownerId !== state.term?.ownerId;
      }
      this.options.client.setOwner(isLeader);
    }
    if (state.leaderId !== previous.leaderId) this.notify();
  }

  // ── leader：伺服器 → 本分頁 ＋ 其他分頁 ──────────────────

  private readonly handleConnected = ({ resumed }: { resumed: boolean }): void => {
    const term = this.currentLeaderTerm();
    if (!term) return;
    this.options.channel.post('status', { term, connected: true });
    if (resumed || this.resyncOnConnect) {
      this.resyncOnConnect = false;
      this.options.channel.post('resync', { term });
      this.scheduleApply([], true);
    }
    this.notify();
  };

  private readonly handleDisconnected = (): void => {
    const term = this.currentLeaderTerm();
    if (term) this.options.channel.post('status', { term, connected: false });
    this.notify();
  };

  private readonly handleServerChanges = ({ changes, origin }: ResourceChanged): void => {
    const term = this.currentLeaderTerm();
    if (!term) return;
    this.sequence += 1;
    // 本分頁發起的也要轉發：其他分頁沒做這次 mutation
    this.options.channel.post('resource-changed', {
      term,
      sequence: this.sequence,
      changes,
      ...(origin === undefined ? {} : { origin }),
    });
    if (origin !== this.options.clientId) this.scheduleApply(changes, false);
  };

  private readonly handleStatusRequest = (): void => {
    const term = this.currentLeaderTerm();
    if (term) {
      this.options.channel.post('status', { term, connected: this.options.client.isConnected });
    }
  };

  private currentLeaderTerm(): LeaderTerm | null {
    const { role, term } = this.options.election.state.getState();
    return role === 'leader' ? term : null;
  }

  // ── follower：control channel → 本分頁 ──────────────────

  /** 採信的任期：較新的任期重設序號；較舊的丟掉。回傳這則訊息是否該處理。 */
  private acceptTerm(term: unknown): term is LeaderTerm {
    if (this.options.election.isLeader() || !isLeaderTerm(term)) return false;
    if (this.knownTerm === null || compareLeaderTerm(term, this.knownTerm) > 0) {
      this.knownTerm = term;
      this.lastSequence = 0;
      return true;
    }
    return compareLeaderTerm(term, this.knownTerm) === 0;
  }

  private readonly handleRelayedChanges = (
    message: RealtimeControlMessages['resource-changed'],
  ): void => {
    if (!this.acceptTerm(message.term)) return;
    const { sequence } = message;
    if (!Number.isSafeInteger(sequence) || sequence <= this.lastSequence) return; // 重複或亂序的舊訊息
    const missed = sequence > this.lastSequence + 1;
    this.lastSequence = sequence;
    if (missed) {
      // 漏收了中間的變更，不知道漏了什麼：整批重新驗證
      this.scheduleApply([], true);
      return;
    }
    const changes = parseChanges(message.changes);
    if (changes === undefined) {
      this.scheduleApply([], true);
      return;
    }
    if (message.origin !== this.options.clientId) this.scheduleApply(changes, false);
  };

  private readonly handleResync = ({ term }: RealtimeControlMessages['resync']): void => {
    if (!this.acceptTerm(term)) return;
    this.scheduleApply([], true);
  };

  private readonly handleStatus = ({
    term,
    connected,
  }: RealtimeControlMessages['status']): void => {
    if (!this.acceptTerm(term)) return;
    this.leaderStatus = { term, connected: connected === true };
    this.notify();
  };

  // ── 套用 ───────────────────────────────────────────────

  /**
   * 背景分頁：立刻標 stale、不重抓（成本低，回到前景時由 focus refetch 接手）。
   * 可見分頁：累積起來，隨機延遲後一次套用並重抓。整批重新驗證會蓋過累積的個別變更。
   */
  private scheduleApply(changes: readonly ResourceChangeWire[], resync: boolean): void {
    if (!this.options.visibility.isVisible()) {
      if (resync) this.options.resync({ refetch: false });
      else this.options.applyChanges(changes, { refetch: false });
      return;
    }
    if (resync) this.bufferedResync = true;
    else this.buffered.push(...changes);
    this.throttle.schedule(APPLY_KEY, this.flush, this.jitter);
  }

  private readonly flush = (): void => {
    const changes = this.buffered;
    const resync = this.bufferedResync;
    this.buffered = [];
    this.bufferedResync = false;
    if (resync) this.options.resync({ refetch: true });
    else if (changes.length) this.options.applyChanges(changes, { refetch: true });
  };

  private notify(): void {
    for (const listener of this.availabilityListeners) listener();
  }
}

/** 其他分頁送來的 payload 無法信任型別（新舊版本並存）：逐筆驗證，有一筆不合就整批重新驗證。 */
function parseChanges(raw: unknown): ResourceChangeWire[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed: ResourceChangeWire[] = [];
  for (const item of raw) {
    const result = ResourceChangeWireSchema.safeParse(item);
    if (!result.success) return undefined;
    parsed.push(result.data);
  }
  return parsed;
}
