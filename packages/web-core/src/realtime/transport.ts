import type { ClientEvent, ClientToServerEvents, ServerEvent } from '@b2b-system/realtime';

/** handshake 帶給伺服器的認證資料（docs/architecture/backend/08-realtime.md §3.2）。 */
export interface RealtimeHandshakeAuth {
  token: string;
}

/** 傳輸層回報給 `RealtimeClient` 的連線事件。 */
export interface RealtimeTransportHooks {
  /**
   * 每次（重）連線前取得認證資料；回 `undefined` 代表放棄這次連線，停在斷線狀態。
   * 不可 reject：失敗的處理（記錄、等下次續期）是呼叫端的責任。
   */
  authenticate(): Promise<RealtimeHandshakeAuth | undefined>;
  /** handshake 通過。 */
  onConnect(): void;
  /** 斷線。`byServer`：伺服器主動斷的，傳輸層 **不會** 自動重連。 */
  onDisconnect(info: { byServer: boolean }): void;
  /**
   * handshake 失敗。`code` 是伺服器拒絕時帶的錯誤碼（與 HTTP 同一套），此時傳輸層不會自動重試；
   * `undefined` 代表網路、proxy 層的失敗，傳輸層會自己退避重連。
   */
  onConnectError(info: { code: string | undefined; cause: unknown }): void;
}

/**
 * `RealtimeClient` 對連線的所有要求（docs/architecture/frontend/11-realtime.md §2）。
 * 實作只有 `socketIoRealtimeTransport()`；換掉 Socket.io 時只換這一層。
 */
export interface RealtimeTransport {
  /** handshake 已通過。 */
  readonly isConnected: boolean;
  /** 連線中、已連線、或等待自動重連；此時不必再呼叫 `connect()`。 */
  readonly isActive: boolean;
  connect(): void;
  /** 主動斷線；不會自動重連。 */
  disconnect(): void;
  /** 訂閱伺服器事件；payload 未經驗證，由呼叫端依合約的 schema 檢查。 */
  on(event: ServerEvent, listener: (...args: unknown[]) => void): () => void;
  emit<E extends ClientEvent>(event: E, ...args: Parameters<ClientToServerEvents[E]>): void;
  /** 斷線並移除所有監聽，之後不再使用。 */
  dispose(): void;
}

/** 建立傳輸層；只建物件、不連線，`connect()` 之後才開始 handshake。 */
export type CreateRealtimeTransport = (hooks: RealtimeTransportHooks) => RealtimeTransport;
