import { MAIN_BACKEND } from '@/core/client';
import { isSessionRejected } from '@/core/errors';
import { broadcastChannelTransport, createChannel } from '@/shared/channel';
import type { Channel } from '@/shared/channel';
import { EventEmitter } from '@/shared/EventEmitter';
import { createDictStorage } from '@/shared/storage';
import type { DictStorage } from '@/shared/storage';

export interface SessionTokens {
  accessToken: string;
  /** 秒 */
  expiresIn: number;
}

export type SessionStoreEvents = {
  ended: (reason: string) => void;
  refreshed: () => void;
};

type RefreshFn = () => Promise<SessionTokens>;

/** 剩餘壽命少於這個值就先續期（秒）。 */
const REFRESH_THRESHOLD_SECONDS = 30;

const SESSION_CHANNEL_PREFIX = 'session:';
const REFRESH_LOCK_PREFIX = 'ge:refresh:';
const STORAGE_NAMESPACE_PREFIX = 'auth:';
const HAS_SESSION_KEY = 'hasSession';

/** 同一個頻道依序送達：登出之後才到的續期結果一定排在登出之後。 */
export type SessionMessages = {
  'refresh-done': { accessToken: string; expiresAt: number };
  'session-ended': { reason: string };
};

/**
 * 某個後端的 session 頻道：由 `SessionStore` 持有。
 * 明確釘在 BroadcastChannel、不開放選傳輸層：refresh-done 帶著 access token，
 * 不可改走 localStorage（會落地）或 WebSocket（會離開本機），即使預設傳輸層日後被改掉。
 */
export function createSessionChannel(name: string): Channel<SessionMessages> {
  return createChannel(SESSION_CHANNEL_PREFIX + name, { transport: broadcastChannelTransport() });
}

/** 以 `name` 為鍵的跨分頁互斥：同名的 `task` 同一時間只有一個在跑。 */
export type RunExclusive = <T>(name: string, task: () => Promise<T>) => Promise<T>;

export interface SessionStoreOptions {
  /** 預設用 `navigator.locks`（Web Locks）；測試注入假的來模擬多個分頁。 */
  runExclusive?: RunExclusive;
  /** 預設 `createSessionChannel(name)`；交給 store 後由它負責關閉（`dispose()`）。 */
  channel?: Channel<SessionMessages>;
}

/** 瀏覽器不支援 Web Locks 時退回只有分頁內單飛（`inFlight`）。 */
function webLocksExclusive(): RunExclusive {
  const locks = globalThis.navigator?.locks;
  if (!locks) return (_name, task) => task();
  // lib.dom 把回傳型別寫成 Promise<Promise<T>>；規格上 request 會等 task 完成並以其結果 resolve
  return <T>(name: string, task: () => Promise<T>) =>
    locks.request(name, task) as unknown as Promise<T>;
}

/**
 * 一個後端的 session。Access token 只存在這個閉包裡，不進 localStorage / sessionStorage；
 * Refresh token 是 httpOnly cookie，JS 讀不到。
 *
 * 每個後端一個實例，以 `name`（= 後端名稱）隔開跨分頁頻道與 localStorage 旗標：
 * 同名的實例（其他分頁）互相協調續期、同步登出；不同名的彼此完全不干擾。
 */
export class SessionStore {
  readonly events = new EventEmitter<SessionStoreEvents>();

  private accessToken: string | undefined;
  private expiresAt = 0;
  private inFlight: Promise<string | undefined> | undefined;
  private refreshFn: RefreshFn | undefined;
  private ended = false; // latched：只觸發一次
  /** 每次清空 session 就 +1：續期回來時世代不同，代表中途登出過，結果要丟掉。 */
  private epoch = 0;
  private readonly runExclusive: RunExclusive;

  private readonly storage: DictStorage;
  private readonly subscribers = new Set<() => void>();
  private readonly channel: Channel<SessionMessages>;

  constructor(
    readonly name: string,
    options: SessionStoreOptions = {},
  ) {
    this.runExclusive = options.runExclusive ?? webLocksExclusive();
    this.storage = createDictStorage(STORAGE_NAMESPACE_PREFIX + name);
    this.channel = options.channel ?? createSessionChannel(name);
    // 不等 start()：session 從建立起就要跟其他分頁同步，直到 dispose()
    this.channel.on('refresh-done', ({ accessToken, expiresAt }) => {
      // 已結束的 session 不被其他分頁晚到的續期結果救活
      if (!this.ended) this.applyTokens(accessToken, expiresAt);
    });
    this.channel.on('session-ended', ({ reason }) => this.endSession(reason, false));
  }

  setRefreshFn(fn: RefreshFn): void {
    this.refreshFn = fn;
  }

  /** 供 React 以 useSyncExternalStore 訂閱「是否有 session」。 */
  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private notify(): void {
    for (const listener of this.subscribers) listener();
  }

  /** 是否「可能」有 session（有過登入紀錄 → 值得嘗試 refresh）。存的是旗標不是 token。 */
  hasSession(): boolean {
    return Boolean(this.accessToken) || this.storage.get(HAS_SESSION_KEY, false);
  }

  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  setTokens({ accessToken, expiresIn }: SessionTokens): void {
    this.applyTokens(accessToken, Date.now() + expiresIn * 1000);
  }

  /** 本分頁登入／續期，或其他分頁續期完成時共用：新 token 代表 session 重新開始。 */
  private applyTokens(accessToken: string, expiresAt: number): void {
    this.accessToken = accessToken;
    this.expiresAt = expiresAt;
    this.ended = false;
    this.storage.set(HAS_SESSION_KEY, true);
    this.events.emit('refreshed');
    this.notify();
  }

  clear(): void {
    this.accessToken = undefined;
    this.expiresAt = 0;
    this.inFlight = undefined;
    this.epoch += 1;
    this.storage.set(HAS_SESSION_KEY, false);
    this.notify();
  }

  /** session 終止是 latched 的：只會觸發一次登出流程。 */
  endSession(reason: string, broadcast = true): void {
    if (this.ended) return;
    this.ended = true;
    this.clear();
    if (broadcast) this.channel.post('session-ended', { reason });
    this.events.emit('ended', reason);
    this.notify();
  }

  private isFresh(): boolean {
    return (
      Boolean(this.accessToken) && this.expiresAt - Date.now() > REFRESH_THRESHOLD_SECONDS * 1000
    );
  }

  /**
   * 取得可用的 access token，必要時續期。
   * 跨分頁單飛：refresh token 是輪替的，兩個分頁同時用同一個舊 token
   * 會被後端判定為重用攻擊並撤銷整條家族。
   */
  async ensureAccessToken(): Promise<string | undefined> {
    if (this.isFresh()) return this.accessToken;
    if (!this.hasSession()) return undefined;
    this.inFlight ??= this.refresh().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  /**
   * 伺服器以 401 拒絕了 `rejected`：它仍是目前的 token 就強制續期（到期時間還沒到也一樣）；
   * 已被其他請求換掉就直接沿用新的，不重複續期。
   */
  async renewAccessToken(rejected: string | undefined): Promise<string | undefined> {
    if (this.accessToken !== undefined && this.accessToken === rejected) this.expiresAt = 0;
    return this.ensureAccessToken();
  }

  /**
   * 回傳新的 access token；`undefined` 代表 session 已在途中結束（登出、其他分頁續期被拒）。
   *
   * 以 Web Locks 做跨分頁互斥：拿到鎖時，前一個分頁的續期回應已經寫入新的 refresh cookie，
   * 這裡再打也是用新 cookie，不會被判定為重用。BroadcastChannel 只負責把新 token 分享出去。
   */
  private async refresh(): Promise<string | undefined> {
    const refreshFn = this.refreshFn;
    if (!refreshFn) throw new Error('SessionStore.refreshFn 尚未注入');
    const epoch = this.epoch;

    return this.runExclusive(REFRESH_LOCK_PREFIX + this.name, async () => {
      if (epoch !== this.epoch) return undefined;
      // 等鎖期間其他分頁已續期完成，新 token 已經由 refresh-done 送到
      if (this.isFresh()) return this.accessToken;

      try {
        const tokens = await refreshFn();
        // 續期途中 session 已結束（登出）：丟掉結果，否則會把已登出的頁面救活
        if (epoch !== this.epoch) return undefined;
        this.setTokens(tokens);
        this.channel.post('refresh-done', {
          accessToken: tokens.accessToken,
          expiresAt: this.expiresAt,
        });
        return tokens.accessToken;
      } catch (error) {
        // 只有伺服器明確拒絕（refresh token 過期／撤銷／重用、帳號停用）才結束 session；
        // 網路錯誤、5xx、429、逾時是暫時性的：保留 session，下一個請求會再試一次續期
        if (epoch === this.epoch && isSessionRejected(error)) {
          this.endSession(error instanceof Error ? error.message : 'refresh_failed');
        }
        throw error;
      }
    });
  }

  dispose(): void {
    this.channel.close();
    this.events.clear();
  }
}

const stores = new Map<string, SessionStore>();

/** 取得某個後端的 session；還沒有就建立（每個名稱在整個 app 只有一個實例）。 */
export function ensureSessionStore(name: string): SessionStore {
  let store = stores.get(name);
  if (!store) {
    store = new SessionStore(name);
    stores.set(name, store);
  }
  return store;
}

/** 取得已建立的 session；名稱打錯時明確報錯，而不是默默建一個空的。 */
export function getSessionStore(name: string): SessionStore {
  const store = stores.get(name);
  if (!store) throw new Error(`SessionStore "${name}" 尚未建立`);
  return store;
}

export function getSessionStores(): SessionStore[] {
  return Array.from(stores.values());
}

/** 主後端的 session：決定整個 app 的登入狀態。 */
export const sessionStore = ensureSessionStore(MAIN_BACKEND);
