import { CHANNEL_HUB_BYE } from '../relays/sharedWorkerHub';
import type { ChannelTransportFactory } from './types';

/**
 * 經由 SharedWorker 中繼：同源的所有分頁連到同一個 worker，由它轉發給其他分頁。
 * 適合頻道本身就需要一個「跨分頁的單一執行者」時（例：只由 worker 維持一條 WebSocket）。
 * worker 端用 `startChannelHub()`，或直接用 `createChannelHubWorker()`。
 *
 * 所有頻道共用 `worker.port`；頻道 `close()` 只取消訂閱。
 */
export function sharedWorkerTransport(worker: SharedWorker): ChannelTransportFactory {
  const { port } = worker;
  port.start();
  // 分頁關閉時告訴 hub 移除這個 port，否則 hub 的轉發名單只增不減
  globalThis.addEventListener?.('pagehide', () => port.postMessage(CHANNEL_HUB_BYE));

  return () => ({
    post(envelope) {
      port.postMessage(envelope);
    },
    subscribe(listener) {
      const handler = (event: MessageEvent) => listener(event.data);
      port.addEventListener('message', handler);
      return () => port.removeEventListener('message', handler);
    },
    close() {},
  });
}

/** 內建的 hub worker（`workers/channelHub.worker.ts`）；同名的 SharedWorker 在所有分頁是同一個實例。 */
export function createChannelHubWorker(): SharedWorker | undefined {
  if (typeof SharedWorker === 'undefined') return undefined;
  return new SharedWorker(new URL('../workers/channelHub.worker.ts', import.meta.url), {
    type: 'module',
    name: 'ge-channel-hub',
  });
}
