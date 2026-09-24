import type { Socket } from 'socket.io-client';

import { ClientEvent, isRelayableChannel, ServerEvent } from '@/shared/realtime';
import type {
  ChannelEnvelopeWire,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/shared/realtime';

import type { ChannelTransportFactory } from './types';

/** 本專案後端的 Socket.io 連線（事件型別來自 `@/shared/realtime` 的合約）。 */
export type RealtimeSocketLike = Pick<
  Socket<ServerToClientEvents, ClientToServerEvents>,
  'connected' | 'emit' | 'on' | 'off'
>;

/**
 * 經由本專案後端的 Socket.io 中繼：同一個使用者的其他裝置（docs/architecture/frontend/11-realtime.md §7）。
 * 所有頻道共用傳入的這一條連線，以外框的 `channel` 分流（分流、略過自己、去重都在 `createChannel`）。
 *
 * - 只在 `socket.connected` 時送出，斷線時直接丟棄：Socket.io 預設會把斷線期間的 emit 緩衝到重連後補送，
 *   過期的狀態不該在重連時覆蓋其他裝置較新的值。
 * - 不在伺服器白名單（`isRelayableChannel`）的頻道回 `undefined`：送出去也會被伺服器丟掉，
 *   而且 `session:*` 這類帶 token 的頻道不該依賴伺服器擋，本機就不讓它離開。
 * - 連線由 `core/realtime` 建立與關閉（含重連、續期）；頻道 `close()` 只取消訂閱。
 *
 * 既有的 `webSocketTransport` 是原生 WebSocket 的協定，與 Socket.io 不相容。
 */
export function socketIoTransport(socket: RealtimeSocketLike): ChannelTransportFactory {
  return (channelName) => {
    if (!isRelayableChannel(channelName)) return undefined;
    return {
      post(envelope) {
        if (!socket.connected) return;
        // `createChannel` 只會交來自己組好的外框；伺服器會再以 schema 驗一次
        socket.emit(ClientEvent.CHANNEL_RELAY, envelope as ChannelEnvelopeWire);
      },
      subscribe(listener) {
        const handler = (envelope: ChannelEnvelopeWire) => listener(envelope);
        socket.on(ServerEvent.CHANNEL_RELAY, handler);
        return () => {
          socket.off(ServerEvent.CHANNEL_RELAY, handler);
        };
      },
      close() {},
    };
  };
}
