import { isChannelEnvelope } from '../envelope';

interface RelayClient {
  readonly id: string;
  postMessage(message: unknown): void;
}

interface RelayMessageEvent {
  readonly data: unknown;
  readonly source: { readonly id: string } | null;
  waitUntil(promise: Promise<unknown>): void;
}

/** Service Worker 的 global scope 中中繼用得到的部分（專案的 tsconfig 沒有 WebWorker lib）。 */
export interface ServiceWorkerScopeLike {
  readonly clients: {
    matchAll(options: {
      type: 'window';
      includeUncontrolled: boolean;
    }): Promise<readonly RelayClient[]>;
  };
  addEventListener(type: 'message', listener: (event: RelayMessageEvent) => void): void;
}

/**
 * 在 Service Worker 裡呼叫：把任一分頁送來的頻道訊息轉給其他分頁。
 * 不是頻道外框的訊息（SW 自己的其他協定、MSW）原樣略過，不影響它們。
 */
export function relayChannelMessages(scope: ServiceWorkerScopeLike): void {
  scope.addEventListener('message', (event) => {
    if (!isChannelEnvelope(event.data)) return;
    const { data, source } = event;
    event.waitUntil(
      scope.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Service Worker 的 Client 沒有 targetOrigin
        for (const client of clients) if (client.id !== source?.id) client.postMessage(data);
      }),
    );
  });
}
