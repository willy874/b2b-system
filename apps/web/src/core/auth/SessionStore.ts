import { MAIN_BACKEND } from '@/core/client';
import { isSessionRejected } from '@/core/errors';
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
/** 等待其他分頁完成續期的上限（毫秒）。 */
const PEER_REFRESH_TIMEOUT_MS = 3_000;

const TOKEN_CHANNEL_PREFIX = 'ge:token:';
const SESSION_CHANNEL_PREFIX = 'ge:session:';
const STORAGE_NAMESPACE_PREFIX = 'auth:';
const HAS_SESSION_KEY = 'hasSession';

interface TokenMessage {
  type: 'ping' | 'pong' | 'refresh-start' | 'refresh-done' | 'refresh-failed';
  accessToken?: string;
  expiresAt?: number;
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
  /** 內部用：其他分頁的續期結果（成功走公開的 `refreshed`）。 */
  private readonly peerEvents = new EventEmitter<{ refreshFailed: () => void }>();

  private accessToken: string | undefined;
  private expiresAt = 0;
  private inFlight: Promise<string | undefined> | undefined;
  private refreshFn: RefreshFn | undefined;
  private ended = false; // latched：只觸發一次
  private peerSeen = false;
  private peerRefreshStartedAt = 0;

  private readonly storage: DictStorage;
  private readonly subscribers = new Set<() => void>();
  private readonly tokenChannel: BroadcastChannel | undefined;
  private readonly sessionChannel: BroadcastChannel | undefined;

  constructor(readonly name: string) {
    this.storage = createDictStorage(STORAGE_NAMESPACE_PREFIX + name);
    this.tokenChannel = this.createChannel(TOKEN_CHANNEL_PREFIX + name);
    this.sessionChannel = this.createChannel(SESSION_CHANNEL_PREFIX + name);

    this.tokenChannel?.addEventListener('message', (event) => {
      this.onTokenMessage((event as MessageEvent<TokenMessage>).data);
    });
    this.sessionChannel?.addEventListener('message', (event) => {
      const data = (event as MessageEvent<{ type: string; reason?: string }>).data;
      if (data.type === 'session-ended') this.endSession(data.reason ?? 'peer', false);
    });
    // 啟動時 ping 一次：只有確定有其他分頁時才付等待成本
    this.post(this.tokenChannel, { type: 'ping' });
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
    this.storage.set(HAS_SESSION_KEY, false);
    this.notify();
  }

  /** session 終止是 latched 的：只會觸發一次登出流程。 */
  endSession(reason: string, broadcast = true): void {
    if (this.ended) return;
    this.ended = true;
    this.clear();
    if (broadcast) this.post(this.sessionChannel, { type: 'session-ended', reason });
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

  /** 回傳新的 access token；`undefined` 代表等待期間 session 已結束（例如其他分頁續期被拒）。 */
  private async refresh(): Promise<string | undefined> {
    const peer = await this.waitForPeerRefresh();
    if (peer === 'done') return this.accessToken;
    if (this.ended) return undefined;

    if (!this.refreshFn) throw new Error('SessionStore.refreshFn 尚未注入');
    this.post(this.tokenChannel, { type: 'refresh-start' });
    try {
      const tokens = await this.refreshFn();
      this.setTokens(tokens);
      this.post(this.tokenChannel, {
        type: 'refresh-done',
        accessToken: tokens.accessToken,
        expiresAt: this.expiresAt,
      });
      return tokens.accessToken;
    } catch (error) {
      this.post(this.tokenChannel, { type: 'refresh-failed' });
      // 只有伺服器明確拒絕（refresh token 過期／撤銷／重用、帳號停用）才結束 session；
      // 網路錯誤、5xx、429、逾時是暫時性的：保留 session，下一個請求會再試一次續期
      if (isSessionRejected(error)) {
        this.endSession(error instanceof Error ? error.message : 'refresh_failed');
      }
      throw error;
    }
  }

  /**
   * 其他分頁正在續期（3 秒內）→ 等它的結果，不要自己打 API。
   * - `done`：拿到新 token
   * - `failed`：對方續期失敗或 session 已結束 → 不再等（要不要自己打由呼叫端判斷）
   * - `skipped`：沒有人在續期，或等到逾時（那個分頁可能被關了）
   */
  private async waitForPeerRefresh(): Promise<'done' | 'failed' | 'skipped'> {
    if (!this.peerSeen) return 'skipped';
    if (Date.now() - this.peerRefreshStartedAt > PEER_REFRESH_TIMEOUT_MS) return 'skipped';

    return new Promise((resolve) => {
      const finish = (result: 'done' | 'failed' | 'skipped') => {
        clearTimeout(timer);
        offRefreshed();
        offEnded();
        offFailed();
        resolve(result);
      };
      const timer = setTimeout(() => finish('skipped'), PEER_REFRESH_TIMEOUT_MS);
      const offRefreshed = this.events.on('refreshed', () => finish('done'));
      const offEnded = this.events.on('ended', () => finish('failed'));
      const offFailed = this.peerEvents.on('refreshFailed', () => finish('failed'));
    });
  }

  private onTokenMessage(message: TokenMessage): void {
    this.peerSeen = true;
    switch (message.type) {
      case 'ping': {
        this.post(this.tokenChannel, { type: 'pong' });
        break;
      }
      case 'refresh-start': {
        this.peerRefreshStartedAt = Date.now();
        break;
      }
      case 'refresh-done': {
        if (message.accessToken && message.expiresAt) {
          this.applyTokens(message.accessToken, message.expiresAt);
        }
        break;
      }
      case 'refresh-failed': {
        // 暫時性失敗時對方不會結束 session，本分頁不必乾等到逾時
        this.peerRefreshStartedAt = 0;
        this.peerEvents.emit('refreshFailed');
        break;
      }
      default:
        break;
    }
  }

  private createChannel(name: string): BroadcastChannel | undefined {
    return typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(name);
  }

  private post(channel: BroadcastChannel | undefined, message: unknown): void {
    try {
      channel?.postMessage(message);
    } catch {
      /* 分頁關閉中：忽略 */
    }
  }

  destroy(): void {
    this.tokenChannel?.close();
    this.sessionChannel?.close();
    this.events.clear();
    this.peerEvents.clear();
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
