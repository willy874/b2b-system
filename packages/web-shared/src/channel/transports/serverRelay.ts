import { isRelayableChannel } from '@b2b-system/realtime';
import type { ChannelEnvelopeWire } from '@b2b-system/realtime';

import type { ChannelTransportFactory } from './types';

/**
 * 經由本專案後端中繼的連線：只描述頻道需要的部分，不認識底層是 Socket.io 還是別的。
 * 由 `core/realtime` 的 `RealtimeClient.relay` 提供。
 */
export interface ServerRelayLink {
  /** 目前連線中；斷線時送出的訊息直接丟棄。 */
  isConnected(): boolean;
  send(envelope: ChannelEnvelopeWire): void;
  subscribe(listener: (envelope: ChannelEnvelopeWire) => void): () => void;
}

/**
 * 經由本專案後端中繼：同一個使用者的其他裝置（docs/architecture/frontend/11-realtime.md §7）。
 * 所有頻道共用傳入的這一條連線，以外框的 `channel` 分流（分流、略過自己、去重都在 `createChannel`）。
 *
 * - 只在連線中送出，斷線時直接丟棄：傳輸層（例：Socket.io）可能把斷線期間的訊息緩衝到重連後補送，
 *   過期的狀態不該在重連時覆蓋其他裝置較新的值。
 * - 不在伺服器白名單（`isRelayableChannel`）的頻道回 `undefined`：送出去也會被伺服器丟掉，
 *   而且 `session:*` 這類帶 token 的頻道不該依賴伺服器擋，本機就不讓它離開。
 * - 連線由 `core/realtime` 建立與關閉（含重連、續期）；頻道 `close()` 只取消訂閱。
 *
 * 既有的 `webSocketTransport` 是原生 WebSocket 的協定，與本專案後端不相容。
 */
export function serverRelayTransport(link: ServerRelayLink): ChannelTransportFactory {
  return (channelName) => {
    if (!isRelayableChannel(channelName)) return undefined;
    return {
      post(envelope) {
        if (!link.isConnected()) return;
        // `createChannel` 只會交來自己組好的外框；伺服器會再以 schema 驗一次
        link.send(envelope as ChannelEnvelopeWire);
      },
      subscribe(listener) {
        return link.subscribe(listener);
      },
      close() {},
    };
  };
}
