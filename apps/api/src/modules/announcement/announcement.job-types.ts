import { defineJob } from '@/core/jobs';

/** 排程的時間到了（`startAfter = next_run_at`）；`runAt` 與公告目前的 `next_run_at` 不同就是過時的工作。 */
export interface AnnouncementDispatchJobData {
  announcementId: string;
  runAt: string;
}

/** 一次發送的分批寫入；資料只放 id（工作資料不放內容，docs/architecture/backend/10-jobs.md §4）。 */
export interface AnnouncementFanOutJobData {
  dispatchId: string;
}

/** 排程時間到（docs/adr/0031-announcements.md D8）：只建立發送與入列分批寫入，很快。 */
export const ANNOUNCEMENT_DISPATCH_JOB = defineJob<AnnouncementDispatchJobData>(
  'announcement.dispatch',
  {
    scope: 'tenant',
    retryLimit: 5,
    retryDelaySeconds: 30,
    expireInSeconds: 60,
  },
);

/**
 * 分批寫入通知（D9）：上萬人時要幾十個交易，`expireInSeconds` 留足；重做安全（唯一索引略過已寫的人）。
 * 吃資料庫，並行維持 1。
 */
export const ANNOUNCEMENT_FAN_OUT_JOB = defineJob<AnnouncementFanOutJobData>(
  'announcement.fanOut',
  {
    scope: 'tenant',
    retryLimit: 5,
    retryDelaySeconds: 30,
    expireInSeconds: 15 * 60,
  },
);
