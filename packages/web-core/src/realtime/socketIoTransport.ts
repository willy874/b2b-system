import type { ClientToServerEvents, ServerToClientEvents } from '@b2b-system/realtime';
import type { ManagerOptions, Socket, SocketOptions } from 'socket.io-client';

import type { CreateRealtimeTransport, RealtimeTransport } from './transport';

/** 瀏覽器看到的路徑；proxy 會去掉 `/api`（docs/architecture/backend/08-realtime.md §3.1）。 */
export const REALTIME_SOCKET_PATH = '/api/socket.io';

/**
 * 重連的退避：api 重新部署時上千條連線同時斷線，預設的 1–5 秒會讓它們在幾秒內一起打回來（冷快取、每 IP 的
 * handshake 上限）。起點 2 秒、上限 30 秒、隨機 ±50%，把重連攤開到數十秒。
 */
export const REALTIME_RECONNECTION = {
  reconnectionDelay: 2_000,
  reconnectionDelayMax: 30_000,
  randomizationFactor: 0.5,
} as const;

/** 伺服器主動斷線（`socket.disconnect(true)`）時的原因；Socket.io 不會自動重連。 */
const SERVER_DISCONNECT_REASON = 'io server disconnect';

type ContractSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** 測試注入假的 socket；預設以動態載入的 `io()` 建立。 */
export type CreateSocketIo = (
  options: Partial<ManagerOptions & SocketOptions>,
) => ContractSocket | Promise<ContractSocket>;

/**
 * `socket.io-client` 在第一次 `connect()` 時才下載（docs/architecture/frontend/11-realtime.md §2）：
 * 登入頁、沒有當選 leader 的分頁都不連線，不必在首頁的初始載入付這段程式。
 */
const defaultCreateSocket: CreateSocketIo = async (options) => {
  const { io } = await import('socket.io-client');
  return io(options) as ContractSocket;
};

/** 泛型事件名稱對不上 Socket.io 的多載，集中在這裡以寬鬆型別呼叫；型別安全由 `RealtimeTransport` 的簽章保證。 */
interface LooseSocket {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
}

/**
 * `RealtimeTransport` 的 Socket.io 實作：整個 app 只有這個檔案 import `socket.io-client`，而且是動態載入
 * （docs/architecture/frontend/11-realtime.md §2）。socket 在第一次 `connect()` 時建立；之前的 `on()` 先記下，建立後補掛。
 */
export function socketIoRealtimeTransport(
  createSocket: CreateSocketIo = defaultCreateSocket,
): CreateRealtimeTransport {
  return (hooks): RealtimeTransport => {
    let socket: ContractSocket | undefined;
    let loading: Promise<void> | undefined;
    /** 最後一次是要連線（`connect`）還是斷線（`disconnect`）：載入完成時照它決定要不要連。 */
    let wantConnected = false;
    let disposed = false;
    const listeners = new Set<readonly [string, (...args: unknown[]) => void]>();

    const options: Partial<ManagerOptions & SocketOptions> = {
      path: REALTIME_SOCKET_PATH,
      // 不開 long-polling：免 sticky session，也少一條吃 cookie 的 HTTP 路徑
      transports: ['websocket'],
      autoConnect: false,
      ...REALTIME_RECONNECTION,
      // ★ 必須是函式：每次（重）連線都重新取值。寫成物件會一直帶建立當下的 token，
      // 5 分鐘後的重連全部被拒，推播靜默停止（§3.1、§10）
      auth: (cb) => {
        void hooks.authenticate().then((auth) => {
          if (auth) cb({ ...auth });
          else socket?.disconnect();
        });
      },
    };

    const attach = (created: ContractSocket) => {
      socket = created;
      created.on('connect', () => hooks.onConnect());
      created.on('disconnect', (reason) =>
        hooks.onDisconnect({ byServer: reason === SERVER_DISCONNECT_REASON }),
      );
      created.on('connect_error', (error: Error & { data?: unknown }) =>
        hooks.onConnectError({ code: readErrorCode(error.data), cause: error }),
      );
      const loose = created as unknown as LooseSocket;
      for (const [event, listener] of listeners) loose.on(event, listener);
      if (wantConnected) created.connect();
    };

    const load = () => {
      loading ??= Promise.resolve()
        .then(() => createSocket(options))
        .then(
          (created) => {
            if (disposed) {
              created.removeAllListeners();
              return;
            }
            attach(created);
          },
          (error: unknown) => {
            // chunk 載入失敗（多半是部署換版）：回到未連線，下一次 connect() 再試
            loading = undefined;
            if (!disposed) hooks.onConnectError({ code: undefined, cause: error });
          },
        );
    };

    return {
      get isConnected() {
        return socket?.connected ?? false;
      },
      get isActive() {
        // 載入中而且要連線：視為連線中，呼叫端不必再 connect()
        return socket ? socket.active : loading !== undefined && wantConnected;
      },
      connect() {
        wantConnected = true;
        if (socket) socket.connect();
        else load();
      },
      disconnect() {
        wantConnected = false;
        socket?.disconnect();
      },
      on(event, listener) {
        const entry = [event, listener] as const;
        listeners.add(entry);
        (socket as unknown as LooseSocket | undefined)?.on(event, listener);
        return () => {
          listeners.delete(entry);
          (socket as unknown as LooseSocket | undefined)?.off(event, listener);
        };
      },
      emit(event, ...args) {
        (socket as unknown as LooseSocket | undefined)?.emit(event, ...args);
      },
      dispose() {
        disposed = true;
        wantConnected = false;
        listeners.clear();
        socket?.disconnect();
        socket?.removeAllListeners();
      },
    };
  };
}

/** handshake 被拒時伺服器放在 `err.data` 的 `RealtimeConnectErrorData`。 */
function readErrorCode(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const { code } = data as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}
