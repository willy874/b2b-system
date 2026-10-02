import { defineJob } from '@/core/jobs';

/** 排程的時間到了（`startAfter = next_run_at`）；`runAt` 與公告目前的 `next_run_at` 不同就是過時的工作。 */
export interface AnnouncementDispatchJobData {
  announcementId: string;
  runAt: string;
}

/** 事件點：事件的使用者、比對用的群組或角色、預定的時間（觸發時間＋延遲）。 */
export interface AnnouncementEventDispatchJobData {
  announcementId: string;
  event: string;
  userId: string;
  runAt: string;
  groupId?: string;
  roleIds?: string[];
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

/** 每日維護（D10、D19）：補排程與發送紀錄的保留清理；同一個租戶同時只跑一個。 */
export const ANNOUNCEMENT_MAINTENANCE_JOB = defineJob<Record<string, never>>(
  'announcement.maintenance',
  {
    scope: 'tenant',
    exclusive: true,
    retryLimit: 3,
    retryDelaySeconds: 300,
    expireInSeconds: 30 * 60,
  },
);

/** 事件點的發送（D12、D13）：比對受眾、建立一個人的發送紀錄並入列分批寫入；同一個人只會有一筆。 */
export const ANNOUNCEMENT_EVENT_DISPATCH_JOB = defineJob<AnnouncementEventDispatchJobData>(
  'announcement.eventDispatch',
  {
    scope: 'tenant',
    retryLimit: 5,
    retryDelaySeconds: 30,
    expireInSeconds: 60,
  },
);
