import { EventEmitter } from '@/shared/EventEmitter';
import { createDictStorage } from '@/shared/storage';

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

const TOKEN_CHANNEL = 'ge:token';
const SESSION_CHANNEL = 'ge:session';
const HAS_SESSION_KEY = 'hasSession';

interface TokenMessage {
  type: 'ping' | 'pong' | 'refresh-start' | 'refresh-done' | 'refresh-failed';
  accessToken?: string;
  expiresAt?: number;
}

/**
 * Access token 只存在這個閉包裡，不進 localStorage / sessionStorage。
 * Refresh token 是 httpOnly cookie，JS 讀不到。
 */
export class SessionStore {
  readonly events = new EventEmitter<SessionStoreEvents>();

  private accessToken: string | undefined;
  private expiresAt = 0;
  private inFlight: Promise<string> | undefined;
  private refreshFn: RefreshFn | undefined;
  private ended = false; // latched：只觸發一次
  private peerSeen = false;
  private peerRefreshStartedAt = 0;

  private readonly storage = createDictStorage('auth');
  private readonly subscribers = new Set<() => void>();
  private readonly tokenChannel = this.createChannel(TOKEN_CHANNEL);
  private readonly sessionChannel = this.createChannel(SESSION_CHANNEL);

  constructor() {
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
    this.accessToken = accessToken;
    this.expiresAt = Date.now() + expiresIn * 1000;
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

  private async refresh(): Promise<string> {
    const waited = await this.waitForPeerRefresh();
    if (waited) return waited;

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
      // 續期失敗 = session 結束（refresh token 過期、被撤銷、或帳號被停用）
      this.endSession(error instanceof Error ? error.message : 'refresh_failed');
      throw error;
    }
  }

  /** 其他分頁正在續期（3 秒內）→ 等它的結果，不要自己打 API。 */
  private async waitForPeerRefresh(): Promise<string | undefined> {
    if (!this.peerSeen) return undefined;
    if (Date.now() - this.peerRefreshStartedAt > PEER_REFRESH_TIMEOUT_MS) return undefined;

    return new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(undefined); // 逾時：那個分頁可能被關了，自己來
      }, PEER_REFRESH_TIMEOUT_MS);

      const onDone = () => {
        cleanup();
        resolve(this.accessToken);
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.events.off('refreshed', onDone);
      };
      this.events.on('refreshed', onDone);
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
          this.accessToken = message.accessToken;
          this.expiresAt = message.expiresAt;
          this.storage.set(HAS_SESSION_KEY, true);
          this.events.emit('refreshed');
        }
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
  }
}

export const sessionStore = new SessionStore();
