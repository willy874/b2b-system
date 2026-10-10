import type { BatchQueueHost } from './BatchQueueHost';
import type { BatchPort } from './protocol';

/**
 * - `shared-worker`：所有分頁共用一個佇列（worker 裡）
 * - `worker`：不支援 SharedWorker，每個分頁在自己的 dedicated worker 裡跑一個佇列
 * - `inline`：連 Worker 都沒有（測試環境），佇列跑在主執行緒
 */
export type BatchQueueMode = 'shared-worker' | 'worker' | 'inline';

export interface BatchQueueConnection {
  mode: BatchQueueMode;
  port: BatchPort;
  /** 佇列是否跟著這個分頁消失（`BatchQueueClientOptions.ownsHost`）。 */
  ownsHost: boolean;
}

/** 同名的 SharedWorker 在同源的所有分頁是同一個實例。 */
const SHARED_WORKER_NAME = 'ge-batch-queue';

function connectSharedWorker(): BatchQueueConnection | undefined {
  if (typeof SharedWorker === 'undefined') return undefined;
  try {
    const worker = new SharedWorker(
      new URL('./workers/batchQueue.sharedWorker.ts', import.meta.url),
      {
        type: 'module',
        name: SHARED_WORKER_NAME,
      },
    );
    return { mode: 'shared-worker', port: worker.port, ownsHost: false };
  } catch {
    // 例：隱私模式或企業政策停用 SharedWorker；退回 dedicated worker
    return undefined;
  }
}

function connectDedicatedWorker(): BatchQueueConnection | undefined {
  if (typeof Worker === 'undefined') return undefined;
  try {
    const worker = new Worker(new URL('./workers/batchQueue.worker.ts', import.meta.url), {
      type: 'module',
      name: SHARED_WORKER_NAME,
    });
    const port: BatchPort = {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker 沒有 targetOrigin
      postMessage: (message) => worker.postMessage(message),
      addEventListener: (type, listener) => worker.addEventListener(type, listener),
      removeEventListener: (type, listener) => worker.removeEventListener(type, listener),
      close: () => worker.terminate(),
    };
    return { mode: 'worker', port, ownsHost: true };
  } catch {
    return undefined;
  }
}

/**
 * 佇列本體（`BatchQueueHost`）以 `import()` 載入：瀏覽器實際跑在 worker 裡，主執行緒的退路只有測試環境用得到，
 * 不必在首頁的初始載入付這段程式。載入前送出的訊息留在 `port2`，`host.connect` 呼叫 `start()` 後才依序送達。
 */
function connectInline(): BatchQueueConnection {
  const { port1, port2 } = new MessageChannel();
  let host: BatchQueueHost | undefined;
  let closed = false;
  void import('./BatchQueueHost').then(({ BatchQueueHost: Host }) => {
    if (closed) return;
    host = new Host();
    host.connect(port2);
  });
  const port: BatchPort = {
    postMessage: (message) => port1.postMessage(message),
    addEventListener: (type, listener) => port1.addEventListener(type, listener),
    removeEventListener: (type, listener) => port1.removeEventListener(type, listener),
    start: () => port1.start(),
    close: () => {
      closed = true;
      host?.dispose();
      port1.close();
    },
  };
  return { mode: 'inline', port, ownsHost: true };
}

/**
 * 連上批次佇列：優先 SharedWorker（跨分頁共用、發起的分頁關掉仍繼續），
 * 不支援時退回主執行緒開的 dedicated worker（佇列只屬於這個分頁，進度仍經 Channel 讓其他分頁看到）。
 */
export function connectBatchQueue(): BatchQueueConnection {
  return connectSharedWorker() ?? connectDedicatedWorker() ?? connectInline();
}
