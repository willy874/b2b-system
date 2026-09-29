import type { ChannelTransportFactory } from './types';

/**
 * 同源的所有分頁、iframe、dedicated worker。預設的傳輸層。
 * 訊息以 structured clone 傳遞，只在本機瀏覽器內，不經過任何儲存或伺服器。
 */
export function broadcastChannelTransport(): ChannelTransportFactory {
  return (channelName) => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel(channelName);
    return {
      post(envelope) {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel 沒有 targetOrigin，只會送到同源
        channel.postMessage(envelope);
      },
      subscribe(listener) {
        const handler = (event: MessageEvent) => listener(event.data);
        channel.addEventListener('message', handler);
        return () => channel.removeEventListener('message', handler);
      },
      close() {
        channel.close();
      },
    };
  };
}
