import {
  defineNotification,
  NotificationChannel,
} from '@/modules/notification/notification.definition';
import type {
  AnyNotificationType,
  NotificationLink,
} from '@/modules/notification/notification.definition';

import { ANNOUNCEMENT_MESSAGE_ROUTE } from './announcement.constants';

/** 公告送達（docs/adr/0031-announcements.md D4）：參數只放標題（名稱快照），全文從發送紀錄讀。 */
export type AnnouncementPublishedParams = { title: string };

/**
 * 預設不允許個人關掉（D16）：公司公告不該被個人靜音，租戶可以在事件管理頁打開。
 * 不設 `mandatory`：租戶要能整個關掉。
 */
export const ANNOUNCEMENT_PUBLISHED_NOTIFICATION = defineNotification<AnnouncementPublishedParams>(
  'announcement.published',
  {
    category: 'announcement',
    channels: [NotificationChannel.IN_APP],
    feature: 'announcement',
    defaultAllowUserOverride: false,
  },
);

/** `AnnouncementModule` 登記進事件目錄的類型。 */
export const ANNOUNCEMENT_NOTIFICATIONS: readonly AnyNotificationType[] = [
  ANNOUNCEMENT_PUBLISHED_NOTIFICATION,
];

/** 收件人看全文的頁面（前端 `/announcement/message/$dispatchId`）。 */
export function announcementMessageLink(dispatchId: string): NotificationLink {
  return { route: ANNOUNCEMENT_MESSAGE_ROUTE, params: { dispatchId } };
}
