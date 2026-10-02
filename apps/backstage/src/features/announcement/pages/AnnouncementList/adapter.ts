import type { Announcement } from '@/shared/api-sdk';

/** 列表的一列。 */
export interface AnnouncementRowVM {
  id: string;
  title: string;
  status: Announcement['status'];
  trigger: Announcement['trigger'];
  /** 排程中的下一次；不在排程中為 null。 */
  nextRunAt: string | null;
  /** 最近一次發送的已讀與人數；還沒發過、發送還沒完成時為 null。 */
  readSummary: { read: number; total: number } | null;
  updatedAt: string;
}

export function toAnnouncementRowVM(announcement: Announcement): AnnouncementRowVM {
  const last = announcement.lastDispatch;
  return {
    id: announcement.id,
    title: announcement.title,
    status: announcement.status,
    trigger: announcement.trigger,
    nextRunAt: announcement.nextRunAt,
    readSummary:
      last && last.recipientCount !== null
        ? { read: last.readCount, total: last.recipientCount }
        : null,
    updatedAt: announcement.updatedAt,
  };
}
