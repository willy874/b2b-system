import type { ChannelTransportFactory } from './types';

/**
 * 經由 Service Worker 中繼：送給 `controller`，由 SW 轉發給其他分頁（SW 端用 `relayChannelMessages()`）。
 * 適合 SW 本身也要收發頻道訊息時（例：背景同步完成後通知所有分頁失效快取）。
 *
 * - 頁面還沒被 SW 控制時（第一次安裝、強制重新整理）`controller` 是 `null`，訊息會被丟棄；
 *   只在「送不到也沒關係」或搭配 `combineTransports` 時使用。
 * - 所有頻道共用 `navigator.serviceWorker`；頻道 `close()` 只取消訂閱。
 */
export function serviceWorkerTransport(
  container: ServiceWorkerContainer | undefined = globalThis.navigator?.serviceWorker,
): ChannelTransportFactory {
  // addEventListener 註冊的 message listener 要 startMessages() 之後才會收到（onmessage 會自動呼叫）
  container?.startMessages();

  return () => {
    if (!container) return undefined;
    return {
      post(envelope) {
        container.controller?.postMessage(envelope);
      },
      subscribe(listener) {
        const handler = (event: MessageEvent) => listener(event.data);
        container.addEventListener('message', handler);
        return () => container.removeEventListener('message', handler);
      },
      close() {},
    };
  };
}
