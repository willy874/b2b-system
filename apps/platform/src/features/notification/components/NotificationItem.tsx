import { useTranslation } from '@b2b-system/web-core/locales';
import { bindNotificationRowActions, NotificationRow } from '@b2b-system/web-core/notification';
import type {
  NotificationContent,
  NotificationRowActions,
} from '@b2b-system/web-core/notification';
import { useRouteLinkResolver } from '@b2b-system/web-core/route-link';

import { notificationMessage } from '../adapter';
import type { NotificationVM } from '../adapter';

interface NotificationItemProps {
  notification: NotificationVM;
  actions: NotificationRowActions<NotificationVM>;
  selected?: boolean;
}

/**
 * 一則通知：組好句子、解析連結，交給共用的 `NotificationRow`（`web-core/notification`）。
 * 平台的通知沒有觸發者；route id 沒有登記或缺參數時沒有快速連結。
 */
export function NotificationItem({
  notification,
  actions,
  selected = false,
}: NotificationItemProps) {
  const { t } = useTranslation();
  const resolve = useRouteLinkResolver();
  const content: NotificationContent = {
    id: notification.id,
    isRead: notification.isRead,
    icon: notification.icon,
    message: notificationMessage(t, notification),
    details: notification.detail ? [notification.detail] : [],
    createdAt: notification.createdAt,
    link: resolve(notification.link),
  };
  return (
    <NotificationRow
      {...content}
      {...bindNotificationRowActions(notification, content, actions, selected)}
    />
  );
}
