import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { getSessionStore } from '@b2b-system/web-core/auth';
import {
  BatchQueueClient,
  connectBatchQueue,
  setActiveBatchQueue,
} from '@b2b-system/web-core/batch';
import type { BatchQueueConnection } from '@b2b-system/web-core/batch';
import { CLIENT_ID } from '@b2b-system/web-core/realtime';

export interface BatchQueuePluginOptions {
  /** 佇列要跟著哪個後端的 session：session 結束時清空佇列，畫面只顯示目前身分的工作。 */
  backend: string;
  /** 測試注入：預設 `connectBatchQueue()`（SharedWorker → dedicated worker → 主執行緒）。 */
  connect?: () => BatchQueueConnection;
}

/**
 * 全域批次佇列（docs/architecture/frontend/07-ui-system.md §13、docs/architecture/frontend/07-ui-system.md §6.2）。
 *
 * | 時機                    | 動作                                                        |
 * | ----------------------- | ----------------------------------------------------------- |
 * | `use()`（同步）         | 連上佇列（worker）、建立分頁端的 client 並登記               |
 * | `onInit`                | `start()`：加入佇列、要目前的進度快照                         |
 * | `pagehide` / `pageshow` | 分頁關閉或進 bfcache 時離開（執行中的項目交給其他分頁）；回來時重新加入 |
 * | session 結束            | 清空佇列（`reset`）：中止進行中的工作、移除所有工作（含已結束的），不彈出結果——之後的每一筆都只會得到 401，留著的結果清單是上一個人的操作紀錄 |
 * | 身分改變（續期、結束）  | 依目前身分過濾畫面上的工作（`principalChanged`）：同源的佇列是共用的，換人登入後看不到前一個人的工作 |
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
      principal: () => getSessionStore(options.backend).getIdentity(),
    });
    setActiveBatchQueue(client);

    const onPageHide = () => client.stop();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void client.start();
    };
    let offSession: (() => void)[] = [];

    return {
      name: 'batch-queue',
      attrs: { batchQueue: client },
      onInit: () => {
        void client.start();
        const session = getSessionStore(options.backend);
        offSession = [
          session.events.on('ended', () => {
            client.reset();
            client.principalChanged();
          }),
          session.events.on('refreshed', () => client.principalChanged()),
        ];
        globalThis.addEventListener?.('pagehide', onPageHide);
        globalThis.addEventListener?.('pageshow', onPageShow);
      },
      onDestroy: () => {
        globalThis.removeEventListener?.('pagehide', onPageHide);
        globalThis.removeEventListener?.('pageshow', onPageShow);
        for (const off of offSession) off();
        client.dispose();
        setActiveBatchQueue(undefined);
      },
    };
  };
}

declare module '@b2b-system/web-core/app/context' {
  interface AppPluginProperties {
    batchQueue?: BatchQueueClient;
  }
}
