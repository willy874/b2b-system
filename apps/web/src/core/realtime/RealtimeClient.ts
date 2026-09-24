import { io } from 'socket.io-client';
import type { ManagerOptions, Socket, SocketOptions } from 'socket.io-client';

import type { SessionStore } from '@/core/auth';
import { ErrorCodes } from '@/core/errors';
import { EventEmitter } from '@/shared/EventEmitter';
import {
  ClientEvent,
  ResourceChangedSchema,
  ServerEvent,
  SessionRevokedReason,
} from '@/shared/realtime';
import type {
  ClientToServerEvents,
  ResourceChanged,
  ServerToClientEvents,
  SessionRenewResult,
} from '@/shared/realtime';

/** 本專案後端的 Socket.io 連線（事件型別來自 `@/shared/realtime` 的合約）。 */
export type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type RealtimeSocketOptions = Partial<ManagerOptions & SocketOptions>;

/** 建立 socket 的工廠；預設是 `io()`，測試注入假的 socket。 */
export type CreateRealtimeSocket = (options: RealtimeSocketOptions) => RealtimeSocket;

/** 瀏覽器看到的路徑；proxy 會去掉 `/api`（docs/architecture/backend/08-realtime.md §3.1）。 */
export const REALTIME_SOCKET_PATH = '/api/socket.io';

/** 伺服器主動斷線（`socket.disconnect(true)`）時的原因；Socket.io 不會自動重連。 */
const SERVER_DISCONNECT_REASON = 'io server disconnect';

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
  createSocket?: CreateRealtimeSocket;
}

type AnyListener = (...args: unknown[]) => void;

/** 自訂事件的執行期驗證：看不懂（新舊版本並存）就略過，不交給訂閱者。 */
const SERVER_EVENT_SCHEMAS: Partial<
  Record<ServerEvent, { safeParse: (raw: unknown) => { success: boolean; data?: unknown } }>
> = {
  [ServerEvent.RESOURCE_CHANGED]: ResourceChangedSchema,
};

const REVOKED_REASONS = new Set<string>(Object.values(SessionRevokedReason));

const defaultCreateSocket: CreateRealtimeSocket = (options) => io(options) as RealtimeSocket;

/**
 * 包裝 socket.io-client：連線、續期、事件分派（docs/architecture/frontend/11-realtime.md §3–§6）。
 * 整個 app 只有這裡（與 `shared/channel` 的 `socketIoTransport`）碰 Socket.io。
 *
 * 建立時只建 `Socket` 物件、不連線（`autoConnect: false`），讓頻道能在啟動時就綁上傳輸層；
 * `start()` 之後才依 session 狀態連線。推播只是加速：任何失敗都不拋給使用者，功能退回定期重抓。
 */
export class RealtimeClient {
  readonly events = new EventEmitter<RealtimeClientEvents>();
  readonly socket: RealtimeSocket;

  private readonly session: SessionStore;
  private readonly statusListeners = new Set<() => void>();
  private readonly offs: (() => void)[] = [];

  /** 最近一次 handshake 送出的 token：被拒時要告訴 SessionStore「哪一張」被拒。 */
  private handshakeToken: string | undefined;
  /** `AUTH_TOKEN_INVALID` 只以續期後的 token 重試一次，避免與伺服器無限來回。 */
  private renewRetried = false;
  private hasConnectedBefore = false;
  /** 收到 `session.expired`：接下來伺服器的斷線要自己重連（Socket.io 不會）。 */
  private expiredPending = false;
  private started = false;
  private destroyed = false;
  /**
   * 這個分頁是否擁有推播連線（docs/architecture/frontend/11-realtime.md §3）。
   * 預設 `true`（單獨使用時照舊連線）；由 `RealtimeCoordinator` 依 leader 選舉結果切換。
   */
  private isOwner = true;

  constructor({ session, createSocket = defaultCreateSocket }: RealtimeClientOptions) {
    this.session = session;
    this.socket = createSocket({
      path: REALTIME_SOCKET_PATH,
      // 不開 long-polling：免 sticky session，也少一條吃 cookie 的 HTTP 路徑
      transports: ['websocket'],
      autoConnect: false,
      // ★ 必須是函式：每次（重）連線都重新取值。寫成物件會一直帶建立當下的 token，
      // 5 分鐘後的重連全部被拒，推播靜默停止（§3.1、§10）
      auth: (cb) => this.provideHandshakeAuth(cb),
    });

    this.socket.on('connect', this.handleConnect);
    this.socket.on('disconnect', this.handleDisconnect);
    this.socket.on('connect_error', this.handleConnectError);
    this.socket.on(ServerEvent.SESSION_EXPIRED, this.handleSessionExpired);
    this.socket.on(ServerEvent.SESSION_REVOKED, this.handleSessionRevoked);
    for (const event of FORWARDED_SERVER_EVENTS) this.forwardServerEvent(event);
  }

  /** 連線中（handshake 已通過）。 */
  get isConnected(): boolean {
    return this.socket.connected;
  }

  /** 連線狀態改變時通知（供 `useSyncExternalStore` 或非 React 程式碼）。 */
  subscribe(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * 訂閱伺服器事件。有 schema 的事件先驗證，不合就略過；socket 重連後訂閱仍有效。
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
    // 泛型事件名稱無法對應到 Socket.io 的重載，這裡以寬鬆型別註冊；型別安全由參數簽章保證
    const socket = this.socket as unknown as {
      on(event: string, listener: AnyListener): unknown;
      off(event: string, listener: AnyListener): unknown;
    };
    socket.on(event, wrapped);
    return () => {
      socket.off(event, wrapped);
    };
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
    this.socket.disconnect();
  }

  /** 擁有連線、有 session、且尚未在連線（或重連中）時才連；重複呼叫無副作用。 */
  connect(): void {
    if (!this.started || this.destroyed || !this.isOwner) return;
    if (this.socket.active || !this.session.hasSession()) return;
    this.socket.connect();
  }

  /** 斷線並移除所有監聽（plugin `onDestroy`）。 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.offs.splice(0)) off();
    this.socket.disconnect();
    this.socket.removeAllListeners();
    this.events.clear();
    this.statusListeners.clear();
  }

  private provideHandshakeAuth(cb: (data: object) => void): void {
    // 經過 Web Locks 單飛：多個分頁同時重連不會各自輪替 refresh token
    this.session.ensureAccessToken().then(
      (token) => {
        if (!token) {
          // 已登出：不送 handshake，停在斷線狀態，等下次登入再連
          this.socket.disconnect();
          return;
        }
        this.handshakeToken = token;
        cb({ token });
      },
      (error: unknown) => {
        // 續期暫時失敗（網路、5xx）：先不連；下次續期成功（`refreshed`）會再連
        warn('取得 handshake token 失敗，暫停推播', error);
        this.socket.disconnect();
      },
    );
  }

  private readonly handleConnect = (): void => {
    this.renewRetried = false;
    const resumed = this.hasConnectedBefore;
    this.hasConnectedBefore = true;
    this.notify();
    this.events.emit(RealtimeClientEvent.CONNECTED, { resumed });
  };

  private readonly handleDisconnect = (reason: string): void => {
    this.notify();
    this.events.emit(RealtimeClientEvent.DISCONNECTED);
    if (reason === SERVER_DISCONNECT_REASON && this.expiredPending) {
      this.expiredPending = false;
      // handshake 會先透過 ensureAccessToken() 換一張新 token
      this.connect();
    }
  };

  private readonly handleConnectError = (error: Error & { data?: unknown }): void => {
    const code = readErrorCode(error.data);
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
        // 網路、proxy：交給 Socket.io 的指數退避重連
        warn('推播連線失敗，稍後自動重試', error);
        return;
      default:
        // 其他 handshake 拒絕（來源、速率限制…）：Socket.io 不會自動重試，下次續期時再連
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
    if (this.socket.connected) this.renewConnection();
    // 登入、或閒置後第一次續期：還沒連就連（重連中則由下一次 handshake 取新 token）
    else this.connect();
  };

  private readonly handleEnded = (): void => {
    this.hasConnectedBefore = false;
    this.expiredPending = false;
    this.handshakeToken = undefined;
    this.socket.disconnect();
  };

  /** 把新 token 送給伺服器，延長這條連線的授權期限（backend §3.4）。 */
  private renewConnection(): void {
    const token = this.session.getAccessToken();
    if (!token) return;
    this.socket.emit(ClientEvent.SESSION_RENEW, { token }, (result: SessionRenewResult) => {
      if (result.ok || this.destroyed) return;
      // 伺服器不接受新 token：重新 handshake，錯誤碼交給 connect_error 統一處理
      this.socket.disconnect();
      this.connect();
    });
  }

  private notify(): void {
    for (const listener of this.statusListeners) listener();
  }
}

function readErrorCode(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const { code } = data as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
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

/** 推播失敗不顯示給使用者（§3.2）；開發環境記一行方便除錯。 */
function warn(message: string, detail?: unknown): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test') return;
  // oxlint-disable-next-line no-console
  console.warn(`[realtime] ${message}`, detail);
}
