import {
  ClientEvent,
  ResourceChangedSchema,
  ServerEvent,
  SessionRevokedReason,
} from '@b2b-system/realtime';
import type {
  ChannelEnvelopeWire,
  ResourceChanged,
  ServerToClientEvents,
  SessionRenewResult,
} from '@b2b-system/realtime';
import type { ServerRelayLink } from '@b2b-system/web-shared/channel';
import { EventEmitter } from '@b2b-system/web-shared/EventEmitter';

import type { SessionStore } from '../auth';
import { ErrorCodes } from '../errors';
import { addTelemetryBreadcrumb } from '../telemetry';
import type {
  CreateRealtimeTransport,
  RealtimeHandshakeAuth,
  RealtimeTransport,
} from './transport';

/** `RealtimeClient.events` 的事件名稱（前端內部，與伺服器的 `ServerEvent` 分開）。 */
export const RealtimeClientEvent = {
  RESOURCE_CHANGED: 'resourceChanged',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
} as const;

export type RealtimeClientEvent = (typeof RealtimeClientEvent)[keyof typeof RealtimeClientEvent];

export type RealtimeClientEvents = {
  /**
   * 伺服器推來的來源變更（已驗證）。**不**在這裡略過本分頁發起的：leader 要把它轉給其他分頁，
   * 是否在本分頁套用由 `RealtimeCoordinator` 依 `origin` 決定。
   */
  [RealtimeClientEvent.RESOURCE_CHANGED]: (payload: ResourceChanged) => void;
  /** handshake 通過。`resumed`：這個分頁之前連線過，斷線期間的推播已遺失（§5）。 */
  [RealtimeClientEvent.CONNECTED]: (info: { resumed: boolean }) => void;
  [RealtimeClientEvent.DISCONNECTED]: () => void;
};

/**
 * 伺服器事件 → `events` 的事件：驗證後原樣轉發 payload。
 * 不在表上的伺服器事件由 `RealtimeClient` 自己處理（`session.*`）或交給其他模組（`channel.relay`），
 * feature 要聽的用 `useRealtimeEvent()`。
 */
export const SERVER_TO_CLIENT_EVENT = {
  [ServerEvent.RESOURCE_CHANGED]: RealtimeClientEvent.RESOURCE_CHANGED,
} as const satisfies Partial<Record<ServerEvent, RealtimeClientEvent>>;

/** payload 與對應的 `events` 事件一致的伺服器事件。 */
type PayloadMatched = {
  [E in keyof typeof SERVER_TO_CLIENT_EVENT]: Parameters<
    ServerToClientEvents[E]
  > extends Parameters<RealtimeClientEvents[(typeof SERVER_TO_CLIENT_EVENT)[E]]>
    ? E
    : never;
}[keyof typeof SERVER_TO_CLIENT_EVENT];
/** 對照表接到 payload 不同的事件時編譯失敗，而不是執行期把錯的形狀交給訂閱者。 */
type AssertForwardable<T extends PayloadMatched> = T;
export type ForwardedServerEvent = AssertForwardable<keyof typeof SERVER_TO_CLIENT_EVENT>;

const FORWARDED_SERVER_EVENTS = Object.keys(SERVER_TO_CLIENT_EVENT) as ForwardedServerEvent[];

export interface RealtimeClientOptions {
  session: SessionStore;
  /** 連線的實作；app 用 `socketIoRealtimeTransport()`，測試注入假的。 */
  createTransport: CreateRealtimeTransport;
}

type AnyListener = (...args: unknown[]) => void;

/** 自訂事件的執行期驗證：看不懂（新舊版本並存）就略過，不交給訂閱者。 */
const SERVER_EVENT_SCHEMAS: Partial<
  Record<ServerEvent, { safeParse: (raw: unknown) => { success: boolean; data?: unknown } }>
> = {
  [ServerEvent.RESOURCE_CHANGED]: ResourceChangedSchema,
};

const REVOKED_REASONS = new Set<string>(Object.values(SessionRevokedReason));

/**
 * 推播連線：連線、續期、事件分派（docs/architecture/frontend/11-realtime.md §3–§6）。
 * 只依賴 `RealtimeTransport`，不認識底層的協定；對外也不交出連線本身。
 *
 * 建立時只建傳輸層、不連線，讓頻道能在啟動時就綁上 `relay`；
 * `start()` 之後才依 session 狀態連線。推播只是加速：任何失敗都不拋給使用者，功能退回定期重抓。
 */
export class RealtimeClient {
  readonly events = new EventEmitter<RealtimeClientEvents>();

  /**
   * 跨裝置頻道經伺服器中繼時用的連線（`serverRelayTransport(realtime.relay)`，§7）。
   * 只有 leader 分頁真的連線；follower 送出的訊息會被丟棄。
   */
  readonly relay: ServerRelayLink = {
    isConnected: () => this.transport.isConnected,
    send: (envelope) => this.transport.emit(ClientEvent.CHANNEL_RELAY, envelope),
    subscribe: (listener) =>
      this.onServerEvent(ServerEvent.CHANNEL_RELAY, (envelope: ChannelEnvelopeWire) =>
        listener(envelope),
      ),
  };

  private readonly transport: RealtimeTransport;
  private readonly session: SessionStore;
  private readonly statusListeners = new Set<() => void>();
  private readonly offs: (() => void)[] = [];

  /** 最近一次 handshake 送出的 token：被拒時要告訴 SessionStore「哪一張」被拒。 */
  private handshakeToken: string | undefined;
  /** `AUTH_TOKEN_INVALID` 只以續期後的 token 重試一次，避免與伺服器無限來回。 */
  private renewRetried = false;
  private hasConnectedBefore = false;
  /** 收到 `session.expired`：接下來伺服器的斷線要自己重連（傳輸層不會）。 */
  private expiredPending = false;
  private started = false;
  private destroyed = false;
  /**
   * 這個分頁是否擁有推播連線（docs/architecture/frontend/11-realtime.md §3）。
   * 預設 `true`（單獨使用時照舊連線）；由 `RealtimeCoordinator` 依 leader 選舉結果切換。
   */
  private isOwner = true;

  constructor({ session, createTransport }: RealtimeClientOptions) {
    this.session = session;
    this.transport = createTransport({
      authenticate: () => this.handshakeAuth(),
      onConnect: this.handleConnect,
      onDisconnect: this.handleDisconnect,
      onConnectError: this.handleConnectError,
    });

    this.transport.on(ServerEvent.SESSION_EXPIRED, this.handleSessionExpired);
    this.transport.on(ServerEvent.SESSION_REVOKED, this.handleSessionRevoked);
    for (const event of FORWARDED_SERVER_EVENTS) this.forwardServerEvent(event);
  }

  /** 連線中（handshake 已通過）。 */
  get isConnected(): boolean {
    return this.transport.isConnected;
  }

  /** 連線狀態改變時通知（供 `useSyncExternalStore` 或非 React 程式碼）。 */
  subscribe(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * 訂閱伺服器事件。有 schema 的事件先驗證，不合就略過；重連後訂閱仍有效。
   * Feature 請用 `useRealtimeEvent()`，不直接呼叫。
   */
  onServerEvent<E extends ServerEvent>(event: E, listener: ServerToClientEvents[E]): () => void {
    const schema = SERVER_EVENT_SCHEMAS[event];
    const wrapped: AnyListener = (...args) => {
      if (schema) {
        const parsed = schema.safeParse(args[0]);
        if (!parsed.success) return;
        (listener as AnyListener)(parsed.data);
        return;
      }
      (listener as AnyListener)(...args);
    };
    return this.transport.on(event, wrapped);
  }

  /** 依 `SERVER_TO_CLIENT_EVENT` 把伺服器事件（驗證後）轉成 `events` 的事件。 */
  private forwardServerEvent<E extends ForwardedServerEvent>(event: E): void {
    const clientEvent = SERVER_TO_CLIENT_EVENT[event];
    // payload 型別一致由 AssertForwardable 在編譯期保證；泛型下 TS 無法自行對上兩張表
    const emit = this.events.emit.bind(this.events) as (
      name: RealtimeClientEvent,
      ...args: unknown[]
    ) => void;
    this.onServerEvent(event, ((...args: unknown[]) =>
      emit(clientEvent, ...args)) as ServerToClientEvents[E]);
  }

  /** 接上 session：已有 session 就連線，之後跟著登入、續期、登出（§3 生命週期表）。 */
  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.offs.push(
      this.session.events.on('refreshed', this.handleRefreshed),
      this.session.events.on('ended', this.handleEnded),
      // 從無到有（登入）：`hasSession()` 由 false 變 true
      this.session.subscribe(() => this.connect()),
    );
    this.connect();
  }

  /**
   * 切換連線擁有權：失去時斷線（follower 不持有連線），取得時照 session 狀態連線。
   * 重複設定同一個值無副作用。
   */
  setOwner(isOwner: boolean): void {
    if (this.isOwner === isOwner) return;
    this.isOwner = isOwner;
    if (isOwner) {
      this.connect();
      return;
    }
    this.expiredPending = false;
    this.transport.disconnect();
  }

  /** 擁有連線、有 session、且尚未在連線（或重連中）時才連；重複呼叫無副作用。 */
  connect(): void {
    if (!this.started || this.destroyed || !this.isOwner) return;
    if (this.transport.isActive || !this.session.hasSession()) return;
    this.transport.connect();
  }

  /** 斷線並移除所有監聽（plugin `onDestroy`）。 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.offs.splice(0)) off();
    this.transport.dispose();
    this.events.clear();
    this.statusListeners.clear();
  }

  /** 每次（重）連線都重新取 token：一直帶建立當下的那張，5 分鐘後的重連會全部被拒（§3.1、§10）。 */
  private async handshakeAuth(): Promise<RealtimeHandshakeAuth | undefined> {
    try {
      // 經過 Web Locks 單飛：多個分頁同時重連不會各自輪替 refresh token
      const token = await this.session.ensureAccessToken();
      // 已登出：不送 handshake，停在斷線狀態，等下次登入再連
      if (!token) return undefined;
      this.handshakeToken = token;
      return { token };
    } catch (error) {
      // 續期暫時失敗（網路、5xx）：先不連；下次續期成功（`refreshed`）會再連
      warn('取得 handshake token 失敗，暫停推播', error);
      return undefined;
    }
  }

  private readonly handleConnect = (): void => {
    this.renewRetried = false;
    const resumed = this.hasConnectedBefore;
    this.hasConnectedBefore = true;
    this.notify();
    this.events.emit(RealtimeClientEvent.CONNECTED, { resumed });
  };

  private readonly handleDisconnect = ({ byServer }: { byServer: boolean }): void => {
    this.notify();
    this.events.emit(RealtimeClientEvent.DISCONNECTED);
    if (byServer && this.expiredPending) {
      this.expiredPending = false;
      // handshake 會先透過 ensureAccessToken() 換一張新 token
      this.connect();
    }
  };

  private readonly handleConnectError = ({
    code,
    cause,
  }: {
    code: string | undefined;
    cause: unknown;
  }): void => {
    switch (code) {
      case ErrorCodes.AUTH_TOKEN_INVALID:
        void this.retryWithRenewedToken();
        return;
      case ErrorCodes.AUTH_TOKEN_STALE:
      case ErrorCodes.AUTH_ACCOUNT_DISABLED:
        // 與 HTTP 收到同一碼的處理相同
        this.session.endSession(code);
        return;
      case undefined:
        // 網路、proxy：交給傳輸層的退避重連
        warn('推播連線失敗，稍後自動重試', cause);
        return;
      default:
        // 其他 handshake 拒絕（來源、速率限制…）：傳輸層不會自動重試，下次續期時再連
        warn('推播 handshake 被拒', code);
    }
  };

  private async retryWithRenewedToken(): Promise<void> {
    if (this.renewRetried) {
      warn('續期後的 token 仍被拒，停止重連');
      return;
    }
    this.renewRetried = true;
    try {
      const token = await this.session.renewAccessToken(this.handshakeToken);
      if (token) this.connect();
    } catch {
      // 續期被拒時 SessionStore 已結束 session；暫時性失敗則等下次續期
    }
  }

  private readonly handleSessionExpired = (): void => {
    // 不是登出：閒置分頁的 token 過期而沒續期。伺服器接著會斷線，斷線後重連
    this.expiredPending = true;
  };

  private readonly handleSessionRevoked = (payload: unknown): void => {
    const reason = readRevokedReason(payload);
    // latched：同一使用者的其他分頁也會收到並呼叫，`endSession` 只觸發一次登出流程
    this.session.endSession(reason);
  };

  private readonly handleRefreshed = (): void => {
    if (this.transport.isConnected) this.renewConnection();
    // 登入、或閒置後第一次續期：還沒連就連（重連中則由下一次 handshake 取新 token）
    else this.connect();
  };

  private readonly handleEnded = (): void => {
    this.hasConnectedBefore = false;
    this.expiredPending = false;
    this.handshakeToken = undefined;
    this.transport.disconnect();
  };

  /** 把新 token 送給伺服器，延長這條連線的授權期限（backend §3.4）。 */
  private renewConnection(): void {
    const token = this.session.getAccessToken();
    if (!token) return;
    this.transport.emit(ClientEvent.SESSION_RENEW, { token }, (result: SessionRenewResult) => {
      if (result.ok || this.destroyed) return;
      // 伺服器不接受新 token：重新 handshake，錯誤碼交給 onConnectError 統一處理
      this.transport.disconnect();
      this.connect();
    });
  }

  private notify(): void {
    for (const listener of this.statusListeners) listener();
  }
}

function readRevokedReason(payload: unknown): string {
  const reason =
    typeof payload === 'object' && payload !== null
      ? (payload as { reason?: unknown }).reason
      : undefined;
  // 看不懂的原因仍然要登出：撤銷本身才是重點
  return typeof reason === 'string' && REVOKED_REASONS.has(reason)
    ? reason
    : SessionRevokedReason.TOKEN_STALE;
}

/**
 * 推播失敗不顯示給使用者（§3.2）：記成錯誤回報的 breadcrumb（之後若發生錯誤，看得出推播當時的狀況；
 * docs/architecture/frontend/19-observability.md §2），開發環境另外記一行方便除錯。
 */
function warn(message: string, detail?: unknown): void {
  addTelemetryBreadcrumb('realtime', message);
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test') return;
  // oxlint-disable-next-line no-console
  console.warn(`[realtime] ${message}`, detail);
}
