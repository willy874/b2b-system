import type { ChannelTransport, ChannelTransportFactory } from './types';

/** 依序嘗試，用第一個目前環境支援的（例：`BroadcastChannel` → localStorage）。 */
export function fallbackTransport(
  ...factories: readonly ChannelTransportFactory[]
): ChannelTransportFactory {
  return (channelName) => {
    for (const factory of factories) {
      const transport = factory(channelName);
      if (transport) return transport;
    }
    return undefined;
  };
}

/**
 * 同時走多個傳輸層：送出時每個都送，收到任一個就交上來
 * （例：本機分頁走 `BroadcastChannel`，其他裝置走 WebSocket）。
 * 同一則訊息從兩條路都到時，由 `createChannel` 以外框 `id` 去重。
 */
export function combineTransports(
  ...factories: readonly ChannelTransportFactory[]
): ChannelTransportFactory {
  return (channelName) => {
    const transports = factories
      .map((factory) => factory(channelName))
      .filter((transport): transport is ChannelTransport => transport !== undefined);
    if (transports.length === 0) return undefined;
    return {
      post(envelope) {
        // 一條路失敗不影響其他條
        for (const transport of transports) {
          try {
            transport.post(envelope);
          } catch {
            /* 該傳輸層暫時不可用（分頁關閉中、連線中斷）：其他條照送 */
          }
        }
      },
      subscribe(listener) {
        const offs = transports.map((transport) => transport.subscribe(listener));
        return () => {
          for (const off of offs) off();
        };
      },
      close() {
        for (const transport of transports) transport.close();
      },
    };
  };
}
