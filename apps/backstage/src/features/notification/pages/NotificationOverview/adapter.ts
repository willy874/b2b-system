import type { NotificationOverviewItem } from '@/shared/api-sdk';

import { describeNotification } from '../../adapter';
import type { TranslatableMessage } from '../../adapter';
import { NOTIFICATION_EVENT_LABEL } from '../../constants';

/** 總覽表格的一列。 */
export interface NotificationOverviewRowVM {
  id: string;
  createdAt: string;
  recipientId: string;
  recipientName: string;
  /** 事件的名稱 key；後端有、前端還不認得的類型是 undefined，畫面以 `type` 本身顯示。 */
  eventNameKey: string | undefined;
  type: string;
  /** 收件人看到的句子（以收件人的角度措辭）與補充。 */
  message: TranslatableMessage;
  details: TranslatableMessage[];
  /** 觸發的人；null 是系統。 */
  actorName: string | null;
  readAt: string | null;
}

export function toNotificationOverviewRowVM(
  item: NotificationOverviewItem,
): NotificationOverviewRowVM {
  return {
    id: item.id,
    createdAt: item.createdAt,
    recipientId: item.recipient.id,
    recipientName: item.recipient.name,
    eventNameKey: NOTIFICATION_EVENT_LABEL[item.type]?.nameKey,
    type: item.type,
    ...describeNotification(item),
    actorName: item.actor?.name ?? null,
    readAt: item.readAt,
  };
}
