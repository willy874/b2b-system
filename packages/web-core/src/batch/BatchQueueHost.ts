import { createInstanceId } from '@b2b-system/web-shared/channel';
import type { Channel } from '@b2b-system/web-shared/channel';

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
import type { BatchItemError, BatchItemProgress, BatchJob } from './types';

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

/** 一個工作一次最多並行幾筆：再多只會互搶頻寬，也讓「取消」要中止的請求變多。 */
const MAX_CONCURRENCY = 6;

const runningKey = (jobId: string, itemId: string) => `${jobId}\u0000${itemId}`;

/**
 * 全域批次佇列（docs/architecture/frontend/07-ui-system.md §13）。在 SharedWorker（所有分頁共用一個）或
 * dedicated worker（不支援 SharedWorker 時，每個分頁一個）裡執行，不依賴 DOM。
 *
 * **堵塞式**：整個佇列同一時間只處理一個工作，工作依送進來的順序處理；工作內預設一次一筆——把它交給一個分頁
 * （`execute`），等 `result` 回來才送下一筆。上傳這類彼此獨立的操作可以設 `concurrency` 讓同一個工作
 * 同時處理數筆（docs/architecture/frontend/12-file-manager.md §14）。實際的 HTTP 請求由分頁以一般 API 送出：token、續期、錯誤轉換只在分頁的 `apis/` 一處，
 * access token 不必離開分頁的記憶體。
 *
 * 執行者：優先交給發起的分頁；它關掉了就交給任一個還在、且宣告支援這個操作的分頁
 * （feature 在執行期安裝，各分頁的操作可能暫時不同，docs/architecture/frontend/02-plugin-system.md §9.2 D10）。
 * 執行中的分頁消失時，同一筆改交給其他分頁重送（單筆 API 已處理過的會以 `*_NOT_FOUND` 等錯誤回來）。
 */
export class BatchQueueHost {
  readonly hostId: string;
  private readonly channel: Channel<BatchQueueMessages>;
  private readonly watchClient: WatchClient | undefined;
  private readonly now: () => number;
  private readonly clients = new Map<string, BatchPort>();
  /** 分頁宣告能執行的操作；沒有宣告過的分頁視為全部支援。 */
  private readonly capabilities = new Map<string, ReadonlySet<string>>();
  private readonly detachers = new Set<() => void>();
  private jobs: BatchJob[] = [];
  /** 處理中的項目（`runningKey(jobId, itemId)` → 由哪個分頁處理）。 */
  private readonly running = new Map<string, Running>();
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
    this.capabilities.delete(clientId);
    const orphaned = [...this.running.entries()].filter(([, run]) => run.clientId === clientId);
    if (orphaned.length === 0) return;
    // 這些項目沒有結果：交給其他分頁重送；已被取消的工作不再送，最後一筆收回時通知結束
    for (const [key, run] of orphaned) {
      this.running.delete(key);
      const job = this.findJob(run.jobId);
      if (job) delete job.progress[run.itemId];
    }
    for (const jobId of new Set(orphaned.map(([, run]) => run.jobId))) {
      const job = this.findJob(jobId);
      if (job?.status === 'cancelled' && this.inFlight(jobId) === 0) this.notifyFinished(job);
    }
    // 移除的進度要讓其他分頁知道；沒有分頁了（dedicated worker 隨分頁關閉）就不必，
    // 否則這份快照會晚於 `host-closed` 抵達，讓其他分頁又把工作加回去
    if (this.clients.size > 0) this.broadcast();
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
          ...(message.principal !== undefined && { principal: message.principal }),
          status: 'queued',
          succeeded: [],
          failures: [],
          concurrency: Math.min(
            MAX_CONCURRENCY,
            Math.max(1, Math.floor(message.input.concurrency ?? 1)),
          ),
          progress: {},
          createdAt: this.now(),
        });
        this.broadcast();
        this.pump();
        return;
      }
      case 'result':
        this.settleItem(message.jobId, message.itemId, message.error);
        return;
      case 'progress':
        this.updateProgress(message.jobId, message.itemId, message.progress);
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
      case 'reset':
        this.reset();
        return;
      case 'capabilities':
        if (!clientId) return;
        this.capabilities.set(clientId, new Set(message.operations));
        // 可能剛有分頁能接手等待中的工作
        this.pump();
        return;
      case 'cancel-operations': {
        const operations = new Set(message.operations);
        this.cancel((job) => operations.has(job.operation));
        return;
      }
      default:
        return;
    }
  }

  /**
   * 交派下一筆：佇列中第一個進行中的工作，補滿它的並行數。
   * 前一個工作還有處理中的項目時，後面的工作不開始（工作之間仍是堵塞式）。
   */
  private pump(): void {
    const job = this.jobs.find(isActive);
    if (!job) return;
    const settled = new Set([...job.succeeded, ...job.failures.map((failure) => failure.id)]);
    const pending = job.items.filter(
      (item) => !settled.has(item.id) && !this.running.has(runningKey(job.id, item.id)),
    );
    if (pending.length === 0) {
      if (this.inFlight(job.id) > 0) return;
      this.finish(job);
      this.pump();
      return;
    }
    const executor = this.pickExecutor(job);
    // 沒有任何分頁連著、或連著的分頁都還沒安裝這個操作所屬的 feature：
    // 等下一個分頁 hello 或宣告支援時再繼續
    if (!executor) return;
    if (job.status === 'queued') {
      job.status = 'running';
      this.broadcast();
    }
    for (const item of pending.slice(0, job.concurrency - this.inFlight(job.id))) {
      this.running.set(runningKey(job.id, item.id), {
        jobId: job.id,
        itemId: item.id,
        clientId: executor.clientId,
      });
      this.send(executor.port, {
        type: 'execute',
        jobId: job.id,
        operation: job.operation,
        itemId: item.id,
        version: item.version,
      });
    }
  }

  private settleItem(jobId: string, itemId: string, error: BatchItemError | undefined): void {
    const key = runningKey(jobId, itemId);
    if (!this.running.has(key)) return;
    this.running.delete(key);
    const job = this.findJob(jobId);
    if (job) {
      delete job.progress[itemId];
      const cancelled = job.status === 'cancelled';
      if (!error) {
        job.succeeded.push(itemId);
      } else if (!(cancelled && error.kind === 'aborted')) {
        // 取消時被中止的那一筆不算失敗：它就是「沒有處理」
        const item = job.items.find((candidate) => candidate.id === itemId);
        job.failures.push({ id: itemId, label: item?.label ?? itemId, error });
      }
      // 執行中被取消：最後一筆的結果回來才通知，結果清單才完整
      if (cancelled && this.inFlight(jobId) === 0) this.notifyFinished(job);
      this.broadcast();
    }
    this.pump();
  }

  private updateProgress(jobId: string, itemId: string, progress: BatchItemProgress): void {
    if (!this.running.has(runningKey(jobId, itemId))) return;
    const job = this.findJob(jobId);
    if (!job || !isActive(job)) return;
    job.progress[itemId] = { loaded: progress.loaded, total: progress.total };
    this.broadcast();
  }

  private cancel(match: (job: BatchJob) => boolean): void {
    for (const job of this.jobs) {
      if (!isActive(job) || !match(job)) continue;
      job.status = 'cancelled';
      job.finishedAt = this.now();
      const inFlight = [...this.running.values()].filter((run) => run.jobId === job.id);
      // 處理中的那幾筆：請執行的分頁中止，等結果回來再通知結束
      for (const run of inFlight) {
        const port = this.clients.get(run.clientId);
        if (port) this.send(port, { type: 'abort', jobId: run.jobId, itemId: run.itemId });
      }
      if (inFlight.length === 0) this.notifyFinished(job);
    }
    this.broadcast();
  }

  /**
   * session 結束（docs/architecture/frontend/07-ui-system.md §13.2 D12）：中止處理中的項目、移除所有工作（含已結束的），
   * 廣播空的快照。不送結束通知：結果清單是上一個人的操作紀錄，不能在下一個人的畫面彈出。
   * 處理中的那幾筆已不在 `running`：晚到的結果與進度一律略過，不會把工作加回來。
   */
  private reset(): void {
    for (const run of this.running.values()) {
      const port = this.clients.get(run.clientId);
      if (port) this.send(port, { type: 'abort', jobId: run.jobId, itemId: run.itemId });
    }
    this.running.clear();
    this.jobs = [];
    this.broadcast();
  }

  private inFlight(jobId: string): number {
    let count = 0;
    for (const run of this.running.values()) if (run.jobId === jobId) count += 1;
    return count;
  }

  private findJob(jobId: string): BatchJob | undefined {
    return this.jobs.find((candidate) => candidate.id === jobId);
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
    const owner = this.clients.get(job.ownerId);
    const [first] = this.clients;
    const port = owner ?? first?.[1];
    if (port) this.send(port, { type: 'finished', job: structuredClone(job) });
  }

  private supports(clientId: string, operation: string): boolean {
    return this.capabilities.get(clientId)?.has(operation) ?? true;
  }

  /** 執行者：發起的分頁還在且支援就給它，否則給任一個支援這個操作的分頁。 */
  private pickExecutor(job: BatchJob): { clientId: string; port: BatchPort } | undefined {
    const owner = this.clients.get(job.ownerId);
    if (owner && this.supports(job.ownerId, job.operation)) {
      return { clientId: job.ownerId, port: owner };
    }
    for (const [clientId, port] of this.clients) {
      if (this.supports(clientId, job.operation)) return { clientId, port };
    }
    return undefined;
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
