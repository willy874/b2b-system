import { defineJob, HIGH_VOLUME_RETENTION_SECONDS } from '@/core/jobs';

/** `watch.notify` 的資料：只放 id，名稱與收件人在執行時才取（docs/architecture/backend/10-jobs.md §4）。 */
export interface WatchNotifyJobData {
  resourceType: string;
  resourceId: string;
  actorId: string | null;
}

/**
 * 通知關注者「資源被修改了」（docs/architecture/backend/24-comment.md §8.2 D9）：擁有者在業務交易內入列。
 * 每次修改最多一筆（同一個資源 60 秒內只入列一次），結束後在佇列只留 1 天；通知晚一點送到沒有關係，重試 3 次。
 */
export const WATCH_NOTIFY_JOB = defineJob<WatchNotifyJobData>('watch.notify', {
  scope: 'tenant',
  retryLimit: 3,
  retryDelaySeconds: 60,
  expireInSeconds: 5 * 60,
  deleteAfterSeconds: HIGH_VOLUME_RETENTION_SECONDS,
});
