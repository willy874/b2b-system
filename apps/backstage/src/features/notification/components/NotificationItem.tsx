import { useTranslation } from '@b2b-system/web-core/locales';
import { NotificationRow } from '@b2b-system/web-core/notification';
import { memo } from 'react';

import { translateMessage } from '../adapter';
import type { NotificationVM } from '../adapter';

interface NotificationItemProps {
  notification: NotificationVM;
  /** 點了有連結的一則（標為已讀）；換頁由連結本身處理。 */
  onOpen: (notification: NotificationVM) => void;
  /** 列尾的「標為已讀」：沒有連結的通知也要能標為已讀。 */
  onMarkRead: (notification: NotificationVM) => void;
}

/** 一則通知：把句子與補充翻譯好交給共用的 `NotificationRow`（`web-core/notification`）。 */
export const NotificationItem = memo(function NotificationItem({
  notification,
  onOpen,
  onMarkRead,
}: NotificationItemProps) {
  const { t, language } = useTranslation();
  return (
    <NotificationRow
      id={notification.id}
      isRead={notification.isRead}
      icon={notification.icon}
      message={translateMessage(t, language, notification.message)}
      details={notification.details.map((detail) => translateMessage(t, language, detail))}
      actor={notification.actorName ?? t('notification.actor.system')}
      createdAt={notification.createdAt}
      link={notification.link}
      onOpen={() => onOpen(notification)}
      onMarkRead={() => onMarkRead(notification)}
    />
  );
});
