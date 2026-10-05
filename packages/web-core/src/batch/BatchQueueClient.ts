import { createInstanceId } from '@b2b-system/web-shared/channel';
import type { Channel } from '@b2b-system/web-shared/channel';
import { EventEmitter } from '@b2b-system/web-shared/EventEmitter';

import { serializeBatchError } from './errors';
import { batchOperationRegistry, getBatchOperation } from './operations';
import {
  BATCH_CLIENT_LOCK_PREFIX,
  createBatchQueueChannel,
  isBatchMessage,
  tagMessage,
} from './protocol';
import type {
  BatchClientMessage,
  BatchHostMessage,
  BatchPort,
  BatchQueueMessages,
} from './protocol';
import type { BatchItemProgress, BatchJob, BatchJobInput, BatchOperation } from './types';

export type BatchQueueClientEvents = {
  /** 這個分頁被指定彈出結果的工作（發起的分頁；它關掉了才輪到其他分頁）。 */
  finished: (job: BatchJob) => void;
};

/** 讓 host 能偵測分頁消失：持有鎖直到 `release()`。不支援 Web Locks 時回 `undefined`。 */
export type HoldClientLock = (name: string) => Promise<{ release: () => void }> | undefined;

/** 這個分頁能執行的操作，以及它們何時改變（feature 在執行期安裝或卸載）。 */
export interface BatchOperationSource {
  ids: () => string[];
  subscribe: (listener: () => void) => () => void;
}

const registryOperationSource: BatchOperationSource = {
  ids: () => batchOperationRegistry.keys(),
  subscribe: (listener) => batchOperationRegistry.store.subscribe(() => listener()),
};

export interface BatchQueueClientOptions {
  port: BatchPort;
  /** 本分頁的 `CLIENT_ID`。 */
  clientId: string;
  /** 預設 `createBatchQueueChannel()`；交給 client 後由它負責關閉（`dispose()`）。 */
  channel?: Channel<BatchQueueMessages>;
  /** 預設查 `registerBatchOperation` 的註冊表。 */
  resolveOperation?: (id: string) => BatchOperation | undefined;
  /**
   * 向佇列宣告能執行哪些操作。沒給 `resolveOperation` 時預設是同一個註冊表；
   * 給了 `resolveOperation` 卻沒給這個時不宣告（佇列視為全部支援）。
   */
  operations?: BatchOperationSource;
  /** 預設用 Web Locks。 */
  holdLock?: HoldClientLock;
  /**
   * 佇列跟著這個分頁（dedicated worker、同執行緒）：分頁關閉時佇列也消失，
   * 由這裡經 Channel 宣告，讓其他分頁移除它的工作。
   */
  ownsHost?: boolean;
}

function webLocksHold(): HoldClientLock {
  return (name) => {
    const locks = globalThis.navigator?.locks;
    if (!locks) return undefined;
    return new Promise((resolve) => {
      void locks.request(
        name,
        () =>
          new Promise<void>((release) => {
            resolve({ release });
          }),
      );
    });
  };
}

const EMPTY: readonly BatchJob[] = [];

/** 進度回報的最短間隔：上傳的 progress 事件一秒可達數十次，每次都廣播快照給所有分頁太吵。 */
const PROGRESS_INTERVAL_MS = 200;

const executionKey = (jobId: string, itemId: string) => `${jobId}\u0000${itemId}`;

/**
 * 分頁端的批次佇列：送指令、以一般 API 執行佇列交派的項目，並彙整所有佇列經 Channel 廣播的進度
 * （docs/architecture/frontend/07-ui-system.md §13）。每個分頁一個實例，由 `batchQueuePlugin` 建立。
 *
 * 生命週期：`start()` 連上（可在 `stop()` 後再 `start()`，例：從 bfcache 回來）、
 * `stop()` 告訴佇列這個分頁離開、`dispose()` 關閉頻道與 port。
 */
export class BatchQueueClient {
  readonly events = new EventEmitter<BatchQueueClientEvents>();

  private readonly port: BatchPort;
  private readonly clientId: string;
  private readonly channel: Channel<BatchQueueMessages>;
  private readonly resolveOperation: (id: string) => BatchOperation | undefined;
  private readonly operations: BatchOperationSource | undefined;
  private readonly stopOperations: (() => void) | undefined;
  /** 上一次宣告的操作：比對出被卸載的，請佇列取消它們的工作。 */
  private declared = new Set<string>();
  private readonly holdLock: HoldClientLock;
  private readonly ownsHost: boolean;
  private readonly hosts = new Map<string, { version: number; jobs: readonly BatchJob[] }>();
  private readonly subscribers = new Set<() => void>();
  /** 這個分頁正在處理的項目；佇列要求中止（工作被取消）時用。 */
  private readonly executions = new Map<string, AbortController>();
  private hostId: string | undefined;
  private lock: { release: () => void } | undefined;
  private started = false;
  private jobs: readonly BatchJob[] = EMPTY;

  constructor(options: BatchQueueClientOptions) {
    this.port = options.port;
    this.clientId = options.clientId;
    this.channel = options.channel ?? createBatchQueueChannel();
    this.resolveOperation = options.resolveOperation ?? getBatchOperation;
    this.operations =
      options.operations ?? (options.resolveOperation ? undefined : registryOperationSource);
    this.stopOperations = this.operations?.subscribe(() => this.declareOperations());
    this.holdLock = options.holdLock ?? webLocksHold();
    this.ownsHost = options.ownsHost ?? false;

    this.port.addEventListener('message', this.onPortMessage);
    this.port.start?.();
    this.channel.on('snapshot', ({ hostId, version, jobs }) => {
      const current = this.hosts.get(hostId);
      if (current && current.version >= version) return;
      this.hosts.set(hostId, { version, jobs });
      this.recompute();
    });
    this.channel.on('host-closed', ({ hostId }) => {
      if (this.hosts.delete(hostId)) this.recompute();
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // 先拿到鎖再 hello：佇列收到 hello 後才排隊要同一把鎖，拿到就代表這個分頁不在了
    this.lock = await this.holdLock(BATCH_CLIENT_LOCK_PREFIX + this.clientId);
    if (!this.started) {
      this.lock?.release();
      return;
    }
    this.send({ type: 'hello', clientId: this.clientId });
    this.declareOperations();
    this.channel.post('snapshot-request', {});
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.send({ type: 'bye' });
    this.lock?.release();
    this.lock = undefined;
    if (this.ownsHost && this.hostId) this.channel.post('host-closed', { hostId: this.hostId });
  }

  dispose(): void {
    this.stopOperations?.();
    for (const controller of this.executions.values()) controller.abort();
    this.executions.clear();
    this.stop();
    this.port.removeEventListener('message', this.onPortMessage);
    this.port.close?.();
    this.channel.close();
    this.events.clear();
    this.subscribers.clear();
  }

  /** 送進全域佇列，回傳工作 id。項目依序逐筆處理，進度經 `subscribe` 取得。 */
  enqueue(input: BatchJobInput): string {
    const jobId = createInstanceId();
    this.send({ type: 'enqueue', jobId, input });
    return jobId;
  }

  /** 取消：正在處理的項目會被中止（操作有接 `signal` 時），剩下的不再送出。 */
  cancel(jobId: string): void {
    this.send({ type: 'cancel', jobId });
  }

  /** 取消所有進行中的工作（例：session 結束）。 */
  cancelAll(): void {
    this.send({ type: 'cancel-all' });
  }

  /** 從佇列面板移除一筆已結束的工作。 */
  dismiss(jobId: string): void {
    this.send({ type: 'dismiss', jobId });
  }

  clearFinished(): void {
    this.send({ type: 'clear-finished' });
  }

  /** 供 React 以 `useSyncExternalStore` 訂閱。 */
  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  /** 所有佇列的工作，依建立時間由舊到新；同一個參考直到有變化。 */
  getJobs = (): readonly BatchJob[] => this.jobs;

  private readonly onPortMessage = (event: MessageEvent) => {
    const message: unknown = event.data;
    if (!isBatchMessage<BatchHostMessage>(message)) return;
    switch (message.type) {
      case 'welcome':
        this.hostId = message.hostId;
        return;
      case 'execute':
        void this.execute(message.jobId, message.operation, message.itemId, message.version);
        return;
      case 'abort':
        this.executions.get(executionKey(message.jobId, message.itemId))?.abort();
        return;
      case 'finished':
        this.events.emit('finished', message.job);
        return;
      default:
        return;
    }
  };

  /** 以一般（單筆）API 處理一筆，把成功或失敗回報給佇列。 */
  private async execute(
    jobId: string,
    operationId: string,
    itemId: string,
    version: number | undefined,
  ): Promise<void> {
    const key = executionKey(jobId, itemId);
    const controller = new AbortController();
    this.executions.set(key, controller);
    let lastReport = 0;
    let trailing: ReturnType<typeof setTimeout> | undefined;
    const report = (progress: BatchItemProgress) => {
      clearTimeout(trailing);
      const send = () => {
        lastReport = Date.now();
        this.send({ type: 'progress', jobId, itemId, progress });
      };
      // 節流但保留最後一次：停在 99% 的進度條比略慢的更新更讓人困惑
      if (Date.now() - lastReport >= PROGRESS_INTERVAL_MS) send();
      else trailing = setTimeout(send, PROGRESS_INTERVAL_MS);
    };
    try {
      const operation = this.resolveOperation(operationId);
      if (!operation) throw new Error(`BatchOperation "${operationId}" 尚未註冊`);
      await operation.run(itemId, { signal: controller.signal, reportProgress: report, version });
      clearTimeout(trailing);
      this.send({ type: 'result', jobId, itemId });
    } catch (error) {
      clearTimeout(trailing);
      this.send({ type: 'result', jobId, itemId, error: serializeBatchError(error) });
    } finally {
      this.executions.delete(key);
    }
  }

  /**
   * 向佇列宣告目前能執行的操作；比上一次少了的，代表所屬 feature 被停用（清單對整個租戶一致），
   * 請佇列取消使用它們的工作，否則那些工作會一直等不到能執行的分頁（docs/architecture/frontend/02-plugin-system.md §9.2 D10）。
   */
  private declareOperations(): void {
    if (!this.operations || !this.started) return;
    const next = new Set(this.operations.ids());
    const removed = [...this.declared].filter((id) => !next.has(id));
    this.declared = next;
    this.send({ type: 'capabilities', operations: [...next] });
    if (removed.length > 0) this.send({ type: 'cancel-operations', operations: removed });
  }

  private recompute(): void {
    this.jobs = [...this.hosts.values()]
      .flatMap((host) => host.jobs)
      .toSorted((a, b) => a.createdAt - b.createdAt);
    for (const listener of this.subscribers) listener();
  }

  private send(message: BatchClientMessage): void {
    try {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- MessagePort / Worker 沒有 targetOrigin
      this.port.postMessage(tagMessage(message));
    } catch {
      /* 佇列已關閉（分頁關閉中）：指令送不到，與佇列不存在同樣處理 */
    }
  }
}
