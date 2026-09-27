import type { AppPluginFactory } from '@/core/app';
import { getSessionStore } from '@/core/auth';
import { BatchQueueClient, connectBatchQueue, setActiveBatchQueue } from '@/core/batch';
import type { BatchQueueConnection } from '@/core/batch';
import { CLIENT_ID } from '@/core/realtime';

export interface BatchQueuePluginOptions {
  /** 佇列要跟著哪個後端的 session：session 結束時取消所有進行中的工作。 */
  backend: string;
  /** 測試注入：預設 `connectBatchQueue()`（SharedWorker → dedicated worker → 主執行緒）。 */
  connect?: () => BatchQueueConnection;
}

/**
 * 全域批次佇列（docs/adr/0012-batch-queue-worker.md、docs/architecture/frontend/07-ui-system.md §6.2）。
 *
 * | 時機                    | 動作                                                        |
 * | ----------------------- | ----------------------------------------------------------- |
 * | `use()`（同步）         | 連上佇列（worker）、建立分頁端的 client 並登記               |
 * | `onInit`                | `start()`：加入佇列、要目前的進度快照                         |
 * | `pagehide` / `pageshow` | 分頁關閉或進 bfcache 時離開（執行中的項目交給其他分頁）；回來時重新加入 |
 * | session 結束            | 取消所有進行中的工作：之後的每一筆都只會得到 401               |
 * | `onDestroy`             | 離開並關閉頻道與 port                                         |
 *
 * 必須註冊在 `httpContextPlugin` 之後（要用它建立的 session），feature plugin 之前後都可以：
 * 操作的註冊表在第一個 `execute` 送達前（`onInit` 之後）就已經填好。
 */
export function batchQueuePlugin(options: BatchQueuePluginOptions): AppPluginFactory {
  return () => {
    const connection = (options.connect ?? connectBatchQueue)();
    const client = new BatchQueueClient({
      port: connection.port,
      clientId: CLIENT_ID,
      ownsHost: connection.ownsHost,
    });
    setActiveBatchQueue(client);

    const onPageHide = () => client.stop();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void client.start();
    };
    let offSession: (() => void) | undefined;

    return {
      name: 'batch-queue',
      attrs: { batchQueue: client },
      onInit: () => {
        void client.start();
        offSession = getSessionStore(options.backend).events.on('ended', () => client.cancelAll());
        globalThis.addEventListener?.('pagehide', onPageHide);
        globalThis.addEventListener?.('pageshow', onPageShow);
      },
      onDestroy: () => {
        globalThis.removeEventListener?.('pagehide', onPageHide);
        globalThis.removeEventListener?.('pageshow', onPageShow);
        offSession?.();
        client.dispose();
        setActiveBatchQueue(undefined);
      },
    };
  };
}

declare module '@/core/app/context' {
  interface AppPluginProperties {
    batchQueue?: BatchQueueClient;
  }
}
