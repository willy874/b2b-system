import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

import { useTranslation } from '../locales';
import type { BatchQueueClient } from './BatchQueueClient';
import { loadBatchOperationLocales } from './operations';
import type { BatchItemProgress, BatchJob } from './types';

let active: BatchQueueClient | undefined;
const listeners = new Set<() => void>();

/**
 * 登記目前 app 使用的佇列（由 backstage 的 `plugins/app/batch-queue.ts` 呼叫；測試直接呼叫）。
 * 以模組層級的登記讓 `RichTable`、AppHeader 不必認識 plugin 或 AppContext。
 */
export function setActiveBatchQueue(client: BatchQueueClient | undefined): void {
  active = client;
  for (const listener of listeners) listener();
}

export function getActiveBatchQueue(): BatchQueueClient | undefined {
  return active;
}

function subscribeActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 目前的佇列；plugin 沒註冊時為 `undefined`（批次按鈕不顯示）。 */
export function useBatchQueue(): BatchQueueClient | undefined {
  return useSyncExternalStore(subscribeActive, getActiveBatchQueue);
}

const NO_JOBS: readonly BatchJob[] = [];
const noop = () => () => {};

/** 所有分頁、所有佇列的工作（依建立時間由舊到新）。 */
export function useBatchJobs(): readonly BatchJob[] {
  const queue = useBatchQueue();
  return useSyncExternalStore(queue?.subscribe ?? noop, queue?.getJobs ?? (() => NO_JOBS));
}

/** 這個分頁被指定彈出結果的工作結束時呼叫 `listener`。 */
export function useBatchJobFinished(listener: (job: BatchJob) => void): void {
  const queue = useBatchQueue();
  const latest = useRef(listener);
  useLayoutEffect(() => {
    latest.current = listener;
  });
  useEffect(() => queue?.events.on('finished', (job) => latest.current(job)), [queue]);
}

/**
 * 補載這些工作的操作名稱所在的語系 scope。載入完成時 `useTranslation` 會讓掛著的元件重渲染（目前語系的包），
 * 這裡不必自己重繪。
 */
export function useBatchOperationLocales(jobs: readonly BatchJob[]): void {
  const { language } = useTranslation();
  const key = [...new Set(jobs.map((job) => job.operation))].toSorted().join('|');
  useEffect(() => {
    if (!key) return;
    void loadBatchOperationLocales(key.split('|'), language);
  }, [key, language]);
}

export function isBatchJobActive(job: BatchJob): boolean {
  return job.status === 'queued' || job.status === 'running';
}

/** 已處理（成功＋失敗）的筆數。 */
export function processedCount(job: BatchJob): number {
  return job.succeeded.length + job.failures.length;
}

/**
 * 整體進度（0–1）。項目有 `weight`（例：位元組）時依份量計算，處理中的項目依它回報的進度計入；
 * 否則每筆一樣重。
 */
export function jobProgressRatio(job: BatchJob): number {
  const { total, done } = jobProgressAmount(job);
  return total > 0 ? Math.min(1, done / total) : 0;
}

/** 處理中的一筆完成了多少（0–1）。 */
function fraction({ loaded, total }: BatchItemProgress): number {
  return total > 0 ? Math.min(1, loaded / total) : 0;
}

/**
 * 已完成的份量與總份量；`weighted` 表示單位是項目的 `weight`（例：位元組）而不是筆數。
 * O(項目數)：先建 id → 份量的表再加總。每個快照（每秒數次）在每個顯示進度的元件都會算一次，
 * 上千筆的上傳不能每個已完成的 id 都線性找一次項目。
 */
export function jobProgressAmount(job: BatchJob): {
  done: number;
  total: number;
  weighted: boolean;
} {
  const weighted = job.items.length > 0 && job.items.every((item) => item.weight !== undefined);
  if (!weighted) {
    let done = job.succeeded.length + job.failures.length;
    for (const progress of Object.values(job.progress)) done += fraction(progress);
    return { done, total: job.items.length, weighted };
  }

  const weights = new Map<string, number>();
  let total = 0;
  for (const item of job.items) {
    const weight = item.weight ?? 0;
    weights.set(item.id, weight);
    total += weight;
  }
  let done = 0;
  for (const id of job.succeeded) done += weights.get(id) ?? 0;
  for (const failure of job.failures) done += weights.get(failure.id) ?? 0;
  for (const [id, progress] of Object.entries(job.progress)) {
    done += (weights.get(id) ?? 0) * fraction(progress);
  }
  return { done, total, weighted };
}
