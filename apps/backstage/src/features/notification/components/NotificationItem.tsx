import { useTranslation } from '@b2b-system/web-core/locales';
import { bindNotificationRowActions, NotificationRow } from '@b2b-system/web-core/notification';
import type {
  NotificationContent,
  NotificationRowActions,
} from '@b2b-system/web-core/notification';
import { memo } from 'react';

import { translateMessage } from '../adapter';
import type { NotificationVM } from '../adapter';

interface NotificationItemProps {
  notification: NotificationVM;
  /** 列表的動作（`useMemo` 保持穩定，`memo` 才有效）。 */
  actions: NotificationRowActions<NotificationVM>;
  selected?: boolean;
}

/** 一則通知：把句子與補充翻譯好交給共用的 `NotificationRow`（`web-core/notification`）。 */
export const NotificationItem = memo(function NotificationItem({
  notification,
  actions,
  selected = false,
}: NotificationItemProps) {
  const { t, language } = useTranslation();
  const content: NotificationContent = {
    id: notification.id,
    isRead: notification.isRead,
    icon: notification.icon,
    message: translateMessage(t, language, notification.message),
    details: notification.details.map((detail) => translateMessage(t, language, detail)),
    actor: notification.actorName ?? t('notification.actor.system'),
    createdAt: notification.createdAt,
    link: notification.link,
  };
  return (
    <NotificationRow
      {...content}
      {...bindNotificationRowActions(notification, content, actions, selected)}
    />
  );
});
