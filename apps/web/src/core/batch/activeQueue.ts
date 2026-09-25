import { useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from 'react';

import { useTranslation } from '@/core/locales';

import type { BatchQueueClient } from './BatchQueueClient';
import { loadBatchOperationLocales } from './operations';
import type { BatchJob } from './types';

let active: BatchQueueClient | undefined;
const listeners = new Set<() => void>();

/**
 * 登記目前 app 使用的佇列（由 `plugins/app/batch-queue.ts` 呼叫；測試直接呼叫）。
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
 * 補載這些工作的操作名稱所在的語系 scope，載入後重新渲染。
 * `useTranslation` 只在切換語系時重新渲染，補進語系包不會觸發。
 */
export function useBatchOperationLocales(jobs: readonly BatchJob[]): void {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const { language } = useTranslation();
  const key = [...new Set(jobs.map((job) => job.operation))].toSorted().join('|');
  useEffect(() => {
    if (!key) return;
    let isCurrent = true;
    void loadBatchOperationLocales(key.split('|'), language).then(() => {
      if (isCurrent) rerender();
    });
    return () => {
      isCurrent = false;
    };
  }, [key, language]);
}

export function isBatchJobActive(job: BatchJob): boolean {
  return job.status === 'queued' || job.status === 'running';
}

/** 已處理（成功＋失敗）的筆數。 */
export function processedCount(job: BatchJob): number {
  return job.succeeded.length + job.failures.length;
}
