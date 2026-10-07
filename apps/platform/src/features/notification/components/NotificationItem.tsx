import { useTranslation } from '@b2b-system/web-core/locales';
import { NotificationRow } from '@b2b-system/web-core/notification';
import { useRouteLinkResolver } from '@b2b-system/web-core/route-link';
import { memo } from 'react';

import { notificationMessage } from '../adapter';
import type { NotificationVM } from '../adapter';

interface NotificationItemProps {
  notification: NotificationVM;
  /** 點了有連結的一則（標為已讀）；換頁由連結本身處理。 */
  onOpen: (notification: NotificationVM) => void;
  /** 列尾的「標為已讀」：沒有連結的通知也要能標為已讀。 */
  onMarkRead: (notification: NotificationVM) => void;
}

/**
 * 一則通知：組好句子、解析連結，交給共用的 `NotificationRow`（`web-core/notification`）。
 * 平台的通知沒有觸發者；route id 沒有登記或缺參數時只顯示文字、不可點。
 */
export const NotificationItem = memo(function NotificationItem({
  notification,
  onOpen,
  onMarkRead,
}: NotificationItemProps) {
  const { t } = useTranslation();
  const resolve = useRouteLinkResolver();
  return (
    <NotificationRow
      id={notification.id}
      isRead={notification.isRead}
      icon={notification.icon}
      message={notificationMessage(t, notification)}
      details={notification.detail ? [notification.detail] : []}
      createdAt={notification.createdAt}
      link={resolve(notification.link)}
      onOpen={() => onOpen(notification)}
      onMarkRead={() => onMarkRead(notification)}
    />
  );
});
