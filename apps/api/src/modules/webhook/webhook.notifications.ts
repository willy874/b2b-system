import {
  defineNotification,
  NotificationChannel,
} from '@/modules/notification/notification.definition';
import type {
  AnyNotificationType,
  NotificationLink,
} from '@/modules/notification/notification.definition';

/** 連續失敗而自動停用（docs/architecture/backend/17-webhook.md §9.2 D13）：給停用當下持有 `webhook:update` 的人。參數是名稱快照。 */
export type WebhookDisabledParams = {
  webhookName: string;
  consecutiveFailures: number;
  /** 到達門檻的網址（docs/architecture/backend/17-webhook.md §10.2 D15）；升版前寫入的通知沒有。 */
  url?: string;
};

export const WEBHOOK_DISABLED_NOTIFICATION = defineNotification<WebhookDisabledParams>(
  'webhook.disabled',
  { category: 'webhook', channels: [NotificationChannel.IN_APP], feature: 'webhook' },
);

/** `WebhookModule` 登記進事件目錄的類型。 */
export const WEBHOOK_NOTIFICATIONS: readonly AnyNotificationType[] = [
  WEBHOOK_DISABLED_NOTIFICATION,
];

/** Webhook 詳情（前端 `/webhook/$webhookId`）。 */
export function webhookDetailLink(webhookId: string): NotificationLink {
  return { route: 'webhook.detail', params: { webhookId } };
}
