import { io } from 'socket.io-client';
import type { ManagerOptions, Socket, SocketOptions } from 'socket.io-client';

import type { ClientToServerEvents, ServerToClientEvents } from '@/shared/websocket-sdk';

import type { CreateRealtimeTransport, RealtimeTransport } from './transport';

/** 瀏覽器看到的路徑；proxy 會去掉 `/api`（docs/architecture/backend/08-realtime.md §3.1）。 */
export const REALTIME_SOCKET_PATH = '/api/socket.io';

/**
 * 重連的退避：api 重新部署時上千條連線同時斷線，預設的 1–5 秒會讓它們在幾秒內一起打回來（冷快取、每 IP 的
 * handshake 上限）。起點 2 秒、上限 30 秒、隨機 ±50%，把重連攤開到數十秒（docs/issues/01-performance.md PERF-11）。
 */
export const REALTIME_RECONNECTION = {
  reconnectionDelay: 2_000,
  reconnectionDelayMax: 30_000,
  randomizationFactor: 0.5,
} as const;

/** 伺服器主動斷線（`socket.disconnect(true)`）時的原因；Socket.io 不會自動重連。 */
const SERVER_DISCONNECT_REASON = 'io server disconnect';

type ContractSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** 測試注入假的 socket；預設是 `io()`。 */
export type CreateSocketIo = (options: Partial<ManagerOptions & SocketOptions>) => ContractSocket;

const defaultCreateSocket: CreateSocketIo = (options) => io(options) as ContractSocket;

/** 泛型事件名稱對不上 Socket.io 的多載，集中在這裡以寬鬆型別呼叫；型別安全由 `RealtimeTransport` 的簽章保證。 */
interface LooseSocket {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
}

/**
 * `RealtimeTransport` 的 Socket.io 實作：整個 app 只有這個檔案 import `socket.io-client`
 * （docs/architecture/frontend/11-realtime.md §2）。
 */
export function socketIoRealtimeTransport(
  createSocket: CreateSocketIo = defaultCreateSocket,
): CreateRealtimeTransport {
  return (hooks): RealtimeTransport => {
    const socket = createSocket({
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
          else socket.disconnect();
        });
      },
    });
    const loose = socket as unknown as LooseSocket;

    socket.on('connect', () => hooks.onConnect());
    socket.on('disconnect', (reason) =>
      hooks.onDisconnect({ byServer: reason === SERVER_DISCONNECT_REASON }),
    );
    socket.on('connect_error', (error: Error & { data?: unknown }) =>
      hooks.onConnectError({ code: readErrorCode(error.data), cause: error }),
    );

    return {
      get isConnected() {
        return socket.connected;
      },
      get isActive() {
        return socket.active;
      },
      connect() {
        socket.connect();
      },
      disconnect() {
        socket.disconnect();
      },
      on(event, listener) {
        loose.on(event, listener);
        return () => {
          loose.off(event, listener);
        };
      },
      emit(event, ...args) {
        loose.emit(event, ...args);
      },
      dispose() {
        socket.disconnect();
        socket.removeAllListeners();
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
