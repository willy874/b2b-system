import { createFakeChannelHub } from '@b2b-system/web-shared/testing';

import { BatchQueueClient, BatchQueueHost, createBatchQueueChannel } from '../batch';
import type { BatchOperationSource, ScheduleTimer } from '../batch';
import type { ResourceChange } from '../cache';

/**
 * 同一個行程裡的批次佇列：一個 host（相當於 SharedWorker）＋ 任意個分頁（`openTab`）。
 * port 用 `MessageChannel`，佇列狀態的 Channel 用假的 BroadcastChannel（`createFakeChannelHub`）。
 * 用完呼叫 `dispose()` 關掉 port，否則測試行程不會結束。
 */
export function createFakeBatchQueue(
  hostOptions: {
    /** 佇列的計時器（限流後恢復、進度快照的節流；`BatchQueueHostOptions.scheduleTimer`）；預設 `setTimeout`。 */
    scheduleTimer?: ScheduleTimer;
    /** 佇列的時鐘（`BatchQueueHostOptions.now`）；預設 `Date.now`。 */
    now?: () => number;
  } = {},
) {
  const hub = createFakeChannelHub();
  const host = new BatchQueueHost({
    hostId: 'host',
    channel: createBatchQueueChannel({ transport: hub.transport() }),
    scheduleTimer: hostOptions.scheduleTimer,
    now: hostOptions.now,
  });
  const tabs: BatchQueueClient[] = [];

  function openTab(
    clientId: string,
    options: {
      ownsHost?: boolean;
      host?: BatchQueueHost;
      /** 這個分頁能執行的操作；預設是共用的註冊表（同一個程序裡所有分頁相同）。 */
      operations?: BatchOperationSource;
      /** 這個分頁目前登入的身分（`BatchQueueClientOptions.principal`）；不給時不過濾。 */
      principal?: () => string | undefined;
      /** 操作宣告的變更最後交給它（`BatchQueueClientOptions.invalidate`）。 */
      invalidate?: (changes: readonly ResourceChange[]) => void;
      invalidateIntervalMs?: number;
    } = {},
  ) {
    const { port1, port2 } = new MessageChannel();
    (options.host ?? host).connect(port2);
    const client = new BatchQueueClient({
      port: port1,
      clientId,
      channel: createBatchQueueChannel({ transport: hub.transport() }),
      holdLock: () => undefined,
      ownsHost: options.ownsHost,
      operations: options.operations,
      principal: options.principal,
      invalidate: options.invalidate,
      invalidateIntervalMs: options.invalidateIntervalMs,
    });
    tabs.push(client);
    return client;
  }

  /** 另一個佇列（模擬不支援 SharedWorker 時，每個分頁各自的 dedicated worker）。 */
  function createHost(hostId: string) {
    return new BatchQueueHost({
      hostId,
      channel: createBatchQueueChannel({ transport: hub.transport() }),
    });
  }

  function dispose() {
    for (const tab of tabs.splice(0)) tab.dispose();
    host.dispose();
  }

  return { host, hub, openTab, createHost, dispose };
}
