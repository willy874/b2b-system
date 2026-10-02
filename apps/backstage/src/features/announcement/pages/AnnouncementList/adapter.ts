import type { Announcement } from '@/shared/api-sdk';

/** 列表的一列。 */
export interface AnnouncementRowVM {
  id: string;
  title: string;
  status: Announcement['status'];
  triggerKind: Announcement['trigger']['kind'];
  /** 指定的發送時間；立即發送為 null。 */
  scheduledAt: string | null;
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
    triggerKind: announcement.trigger.kind,
    scheduledAt: announcement.trigger.kind === 'once' ? announcement.trigger.at : null,
    readSummary:
      last && last.recipientCount !== null
        ? { read: last.readCount, total: last.recipientCount }
        : null,
    updatedAt: announcement.updatedAt,
  };
}
