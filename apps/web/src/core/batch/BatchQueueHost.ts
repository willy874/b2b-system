import { createInstanceId } from '@/shared/channel';
import type { Channel } from '@/shared/channel';

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
import type { BatchItemError, BatchJob } from './types';

/** 結束的工作保留幾筆給佇列面板；更舊的自動移除。 */
const FINISHED_LIMIT = 30;

/** `watchClient(clientId, onGone)`：分頁消失（當掉、被系統回收，沒送出 bye）時呼叫 `onGone`。 */
export type WatchClient = (clientId: string, onGone: () => void) => void;

export interface BatchQueueHostOptions {
  hostId?: string;
  /** 預設 `createBatchQueueChannel()`；交給 host 後由它負責關閉（`dispose()`）。 */
  channel?: Channel<BatchQueueMessages>;
  /** 預設用 Web Locks；不支援時只靠分頁關閉前送出的 `bye`。 */
  watchClient?: WatchClient;
  now?: () => number;
}

interface Running {
  jobId: string;
  itemId: string;
  clientId: string;
}

function webLocksWatcher(): WatchClient | undefined {
  const locks = globalThis.navigator?.locks;
  if (!locks) return undefined;
  return (clientId, onGone) => {
    void locks.request(BATCH_CLIENT_LOCK_PREFIX + clientId, async () => onGone());
  };
}

const isActive = (job: BatchJob) => job.status === 'queued' || job.status === 'running';

/**
 * 全域批次佇列（docs/adr/0012-batch-queue-worker.md）。在 SharedWorker（所有分頁共用一個）或
 * dedicated worker（不支援 SharedWorker 時，每個分頁一個）裡執行，不依賴 DOM。
 *
 * **堵塞式**：整個佇列同一時間只處理一筆——把它交給一個分頁（`execute`），等 `result` 回來才送下一筆；
 * 工作依送進來的順序處理。實際的 HTTP 請求由分頁以一般 API 送出：token、續期、錯誤轉換只在分頁的 `apis/` 一處，
 * access token 不必離開分頁的記憶體。
 *
 * 執行者：優先交給發起的分頁；它關掉了就交給任一個還在的分頁（每個分頁都註冊了所有操作）。
 * 執行中的分頁消失時，同一筆改交給其他分頁重送（單筆 API 已處理過的會以 `*_NOT_FOUND` 等錯誤回來）。
 */
export class BatchQueueHost {
  readonly hostId: string;
  private readonly channel: Channel<BatchQueueMessages>;
  private readonly watchClient: WatchClient | undefined;
  private readonly now: () => number;
  private readonly clients = new Map<string, BatchPort>();
  private readonly detachers = new Set<() => void>();
  private jobs: BatchJob[] = [];
  private running: Running | undefined;
  private version = 0;

  constructor(options: BatchQueueHostOptions = {}) {
    this.hostId = options.hostId ?? createInstanceId();
    this.channel = options.channel ?? createBatchQueueChannel();
    this.watchClient = options.watchClient ?? webLocksWatcher();
    this.now = options.now ?? Date.now;
    this.channel.on('snapshot-request', () => this.broadcast(false));
  }

  /** 接上一個分頁的 port（SharedWorker 的 `connect`，或 dedicated worker 的 global scope）。 */
  connect(port: BatchPort): void {
    let clientId: string | undefined;
    const onMessage = (event: MessageEvent) => {
      const message: unknown = event.data;
      if (!isBatchMessage<BatchClientMessage>(message)) return;
      if (message.type === 'hello') {
        clientId = message.clientId;
        this.addClient(message.clientId, port);
        return;
      }
      if (message.type === 'bye') {
        if (clientId) this.removeClient(clientId, port);
        return;
      }
      this.handle(message, clientId);
    };
    port.addEventListener('message', onMessage);
    port.start?.();
    this.detachers.add(() => port.removeEventListener('message', onMessage));
  }

  /** 目前的工作（測試與除錯用）。 */
  getJobs(): readonly BatchJob[] {
    return this.jobs;
  }

  dispose(): void {
    for (const detach of this.detachers) detach();
    this.detachers.clear();
    this.clients.clear();
    this.channel.close();
  }

  private addClient(clientId: string, port: BatchPort): void {
    this.clients.set(clientId, port);
    this.send(port, { type: 'welcome', hostId: this.hostId });
    this.watchClient?.(clientId, () => this.removeClient(clientId, port));
    this.pump();
  }

  private removeClient(clientId: string, port: BatchPort): void {
    // 同一個 clientId 可能已經以新的 port 重新連上（從 bfcache 回來）
    if (this.clients.get(clientId) !== port) return;
    this.clients.delete(clientId);
    const running = this.running;
    if (running?.clientId !== clientId) return;
    // 這一筆沒有結果：交給其他分頁重送；已被取消的工作不再送，直接通知結束
    this.running = undefined;
    const job = this.jobs.find((candidate) => candidate.id === running.jobId);
    if (job?.status === 'cancelled') this.notifyFinished(job);
    this.pump();
  }

  private handle(message: BatchClientMessage, clientId: string | undefined): void {
    switch (message.type) {
      case 'enqueue': {
        if (!clientId || this.jobs.some((job) => job.id === message.jobId)) return;
        // 進度以 id 計算：同一個 id 只處理一次
        const items = [...new Map(message.input.items.map((item) => [item.id, item])).values()];
        this.jobs.push({
          id: message.jobId,
          ...message.input,
          items,
          ownerId: clientId,
          status: 'queued',
          succeeded: [],
          failures: [],
          createdAt: this.now(),
        });
        this.broadcast();
        this.pump();
        return;
      }
      case 'result':
        this.settleItem(message.jobId, message.itemId, message.error);
        return;
      case 'cancel':
        this.cancel((job) => job.id === message.jobId);
        return;
      case 'cancel-all':
        this.cancel(() => true);
        return;
      case 'dismiss':
        this.jobs = this.jobs.filter((job) => isActive(job) || job.id !== message.jobId);
        this.broadcast();
        return;
      case 'clear-finished':
        this.jobs = this.jobs.filter(isActive);
        this.broadcast();
        return;
      default:
        return;
    }
  }

  /** 下一筆：佇列中第一個還有未處理項目的工作。 */
  private pump(): void {
    if (this.running) return;
    const job = this.jobs.find(isActive);
    if (!job) return;
    const done = new Set([...job.succeeded, ...job.failures.map((failure) => failure.id)]);
    const item = job.items.find((candidate) => !done.has(candidate.id));
    if (!item) {
      this.finish(job);
      this.pump();
      return;
    }
    const executor = this.pickExecutor(job);
    // 沒有任何分頁連著：等下一個分頁 hello 時再繼續
    if (!executor) return;
    if (job.status === 'queued') {
      job.status = 'running';
      this.broadcast();
    }
    this.running = { jobId: job.id, itemId: item.id, clientId: executor.clientId };
    this.send(executor.port, {
      type: 'execute',
      jobId: job.id,
      operation: job.operation,
      itemId: item.id,
    });
  }

  private settleItem(jobId: string, itemId: string, error: BatchItemError | undefined): void {
    const running = this.running;
    if (!running || running.jobId !== jobId || running.itemId !== itemId) return;
    this.running = undefined;
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (job) {
      if (error) {
        const item = job.items.find((candidate) => candidate.id === itemId);
        job.failures.push({ id: itemId, label: item?.label ?? itemId, error });
      } else {
        job.succeeded.push(itemId);
      }
      // 執行中被取消：這一筆的結果已記下，剩下的不再送出
      if (job.status === 'cancelled') this.notifyFinished(job);
      this.broadcast();
    }
    this.pump();
  }

  private cancel(match: (job: BatchJob) => boolean): void {
    for (const job of this.jobs) {
      if (!isActive(job) || !match(job)) continue;
      const inFlight = this.running?.jobId === job.id;
      job.status = 'cancelled';
      job.finishedAt = this.now();
      // 正在處理的那一筆等結果回來再通知，結果清單才完整
      if (!inFlight) this.notifyFinished(job);
    }
    this.broadcast();
  }

  private finish(job: BatchJob): void {
    job.status = 'done';
    job.finishedAt = this.now();
    this.notifyFinished(job);
    this.trimFinished();
    this.broadcast();
  }

  /** 結束通知只送一個分頁：發起的分頁還在就給它，否則給任一個分頁。 */
  private notifyFinished(job: BatchJob): void {
    const target = this.pickExecutor(job);
    if (target) this.send(target.port, { type: 'finished', job: structuredClone(job) });
  }

  private pickExecutor(job: BatchJob): { clientId: string; port: BatchPort } | undefined {
    const owner = this.clients.get(job.ownerId);
    if (owner) return { clientId: job.ownerId, port: owner };
    const [first] = this.clients;
    return first ? { clientId: first[0], port: first[1] } : undefined;
  }

  private trimFinished(): void {
    const finished = this.jobs.filter((job) => !isActive(job));
    if (finished.length <= FINISHED_LIMIT) return;
    const drop = new Set(finished.slice(0, finished.length - FINISHED_LIMIT));
    this.jobs = this.jobs.filter((job) => !drop.has(job));
  }

  /** `bump`：狀態有變才遞增版本；回覆 snapshot-request 時沿用目前版本。 */
  private broadcast(bump = true): void {
    if (bump) this.version += 1;
    // 複製一份：同執行緒的傳輸層（inline 模式、測試）不經 structured clone，之後的修改不能影響已送出的快照
    this.channel.post('snapshot', {
      hostId: this.hostId,
      version: this.version,
      jobs: structuredClone(this.jobs),
    });
  }

  private send(port: BatchPort, message: BatchHostMessage): void {
    try {
      port.postMessage(tagMessage(message));
    } catch {
      /* port 已關閉（分頁關閉中）：與分頁消失同樣處理，由 watchClient / bye 移除 */
    }
  }
}
