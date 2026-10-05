import { createChannel } from '@b2b-system/web-shared/channel';
import type { Channel, ChannelOptions } from '@b2b-system/web-shared/channel';

import type { BatchItemError, BatchItemProgress, BatchJob, BatchJobInput } from './types';

/**
 * 佇列有兩條通道（docs/architecture/frontend/07-ui-system.md §13）：
 *
 * | 通道 | 方向 | 內容 |
 * | ---- | ---- | ---- |
 * | port（SharedWorker 的 `MessagePort`、dedicated worker 本身） | 分頁 ⇄ 佇列 | 指令、逐筆執行的請求與結果、結束通知 |
 * | Channel `batch-queue` | 佇列 → 所有分頁 | 佇列狀態（進度）的快照 |
 *
 * 指令只送給自己連上的佇列；狀態經 Channel 廣播，任何分頁（包括連到另一個佇列的分頁）都看得到全部進度。
 */

/** 送到 port 的最小介面：`MessagePort`、`Worker`、worker 的 global scope 都符合。 */
export interface BatchPort {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  start?(): void;
  close?(): void;
}

const TAG = 'ge-batch-queue';

/** 分頁 → 佇列。 */
export type BatchClientMessage =
  | { type: 'hello'; clientId: string }
  | { type: 'bye' }
  | { type: 'enqueue'; jobId: string; input: BatchJobInput }
  | { type: 'result'; jobId: string; itemId: string; error?: BatchItemError }
  | { type: 'progress'; jobId: string; itemId: string; progress: BatchItemProgress }
  | { type: 'cancel'; jobId: string }
  | { type: 'cancel-all' }
  | { type: 'dismiss'; jobId: string }
  | { type: 'clear-finished' }
  /**
   * 這個分頁能執行哪些操作（docs/architecture/frontend/02-plugin-system.md §9.2 D10）：feature 在執行期安裝或卸載，
   * 各分頁的註冊表可能暫時不同。佇列只把項目交給宣告過支援的分頁；沒送過的分頁視為全部支援。
   */
  | { type: 'capabilities'; operations: string[] }
  /** 這些操作所屬的 feature 被停用了：取消使用它們、尚未結束的工作。 */
  | { type: 'cancel-operations'; operations: string[] };

/** 佇列 → 分頁。 */
export type BatchHostMessage =
  | { type: 'welcome'; hostId: string }
  /** 請這個分頁以一般 API 處理一筆；處理完回 `result`。 */
  | { type: 'execute'; jobId: string; operation: string; itemId: string; version?: number }
  /** 工作被取消：中止正在這個分頁處理的那一筆（它會以 `aborted` 的結果回來）。 */
  | { type: 'abort'; jobId: string; itemId: string }
  /** 工作結束（完成或取消）：只送給一個分頁，由它彈出結果。 */
  | { type: 'finished'; job: BatchJob };

type Tagged<T> = T & { tag: typeof TAG };

export function tagMessage<T extends BatchClientMessage | BatchHostMessage>(message: T): Tagged<T> {
  return { ...message, tag: TAG };
}

/** 同一條 port 上可能還有別的協定（例：Vite HMR）：只認得帶標記的。 */
export function isBatchMessage<T extends BatchClientMessage | BatchHostMessage>(
  value: unknown,
): value is Tagged<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { tag?: unknown }).tag === TAG &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

export type BatchQueueMessages = {
  /** 某個佇列的完整狀態；`version` 遞增，晚到的舊快照略過。 */
  snapshot: { hostId: string; version: number; jobs: BatchJob[] };
  /** 分頁加入時向所有佇列要目前的快照。 */
  'snapshot-request': Record<string, never>;
  /** dedicated worker 隨分頁關閉而消失：由該分頁代為宣告，其他分頁移除它的工作。 */
  'host-closed': { hostId: string };
};

/**
 * 佇列狀態的跨分頁頻道。佇列（`BatchQueueHost`）與每個分頁的 `BatchQueueClient` 各持有一個實例。
 * 用預設的 BroadcastChannel：只在本機同源分頁與 worker 之間，項目名稱（email 等）不落地、不離開本機。
 */
export function createBatchQueueChannel(options?: ChannelOptions): Channel<BatchQueueMessages> {
  return createChannel('batch-queue', options);
}

/** 分頁以 Web Locks 持有這把鎖直到關閉；佇列排隊要同一把鎖，拿到就代表分頁已經不在了。 */
export const BATCH_CLIENT_LOCK_PREFIX = 'ge:batch-client:';
