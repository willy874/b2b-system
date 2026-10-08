import {
  defineNotification,
  NotificationChannel,
} from '@/modules/notification/notification.definition';
import type { AnyNotificationType } from '@/modules/notification/notification.definition';

/**
 * 留言與關注的站內通知（docs/architecture/backend/24-comment.md §4）。參數是名稱快照：資源之後改名、留言之後被編輯或刪除，
 * 已送出的通知不變。`resourceType` 讓前端選句子裡的資源名詞（字面量對照表）。
 */

/** 留言裡被 @提及：給被提及而且看得到資源的人。 */
export type CommentMentionedParams = {
  resourceType: string;
  resourceName: string;
  /** 留言的前 100 個字。 */
  excerpt: string;
};

/** 關注的資源有新留言：給關注者（不含作者與這則留言已經提及的人）。 */
export type CommentCreatedParams = CommentMentionedParams;

/** 關注的資源被修改：由擁有者在自己的業務交易內宣告（`WatchService.resourceChanged`），背景工作送出。 */
export type WatchResourceUpdatedParams = {
  resourceType: string;
  resourceName: string;
};

export const COMMENT_MENTIONED_NOTIFICATION = defineNotification<CommentMentionedParams>(
  'comment.mentioned',
  { category: 'comment', channels: [NotificationChannel.IN_APP] },
);

export const COMMENT_CREATED_NOTIFICATION = defineNotification<CommentCreatedParams>(
  'comment.created',
  { category: 'comment', channels: [NotificationChannel.IN_APP] },
);

export const WATCH_RESOURCE_UPDATED_NOTIFICATION = defineNotification<WatchResourceUpdatedParams>(
  'watch.resourceUpdated',
  { category: 'comment', channels: [NotificationChannel.IN_APP] },
);

/** `CommentModule` 登記進事件目錄的類型。 */
export const COMMENT_NOTIFICATIONS: readonly AnyNotificationType[] = [
  COMMENT_MENTIONED_NOTIFICATION,
  COMMENT_CREATED_NOTIFICATION,
  WATCH_RESOURCE_UPDATED_NOTIFICATION,
];
