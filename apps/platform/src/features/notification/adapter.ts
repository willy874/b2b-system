import type { IconName } from '@b2b-system/ui/Icon';
import type { TranslationFacade } from '@b2b-system/web-core/locales';

import type { PlatformNotification } from '@/shared/api-sdk';

import {
  NOTIFICATION_FALLBACK_ICON,
  NOTIFICATION_ICON,
  NOTIFICATION_MESSAGE_KEY,
  NOTIFICATION_ROLE_LABEL_KEY,
  NOTIFICATION_UNKNOWN_KEY,
} from './constants';

export interface NotificationVM {
  id: string;
  isRead: boolean;
  createdAt: string;
  /** 依類型的圖示，讓列表一眼看得出是哪一類事件。 */
  icon: IconName;
  messageKey: string;
  /** 組句子用的名稱；角色已換成語系鍵（`fromKey`／`toKey`）。 */
  params: Record<string, string>;
  /** 補充的一行（例：佈建失敗的原因）；沒有就是 undefined。 */
  detail?: string;
  link: PlatformNotification['link'];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function roleKey(value: unknown): string | undefined {
  const role = asString(value);
  return role && role in NOTIFICATION_ROLE_LABEL_KEY
    ? NOTIFICATION_ROLE_LABEL_KEY[role as keyof typeof NOTIFICATION_ROLE_LABEL_KEY]
    : undefined;
}

/** 後端的通知 → 畫面用的形狀。`params` 只取已知的欄位，其餘忽略。 */
export function toNotificationVM(notification: PlatformNotification): NotificationVM {
  const { params } = notification;
  const strings: Record<string, string> = {};
  for (const key of ['code', 'name'] as const) {
    const value = asString(params[key]);
    if (value) strings[key] = value;
  }
  // 儲存配額警示的使用率（tenant.storageNearQuota）
  if (typeof params.percent === 'number' && Number.isFinite(params.percent)) {
    strings.percent = String(params.percent);
  }
  const fromKey = roleKey(params.from);
  const toKey = roleKey(params.to);
  if (fromKey) strings.fromKey = fromKey;
  if (toKey) strings.toKey = toKey;
  return {
    id: notification.id,
    isRead: notification.readAt !== null,
    createdAt: notification.createdAt,
    icon: NOTIFICATION_ICON[notification.type] ?? NOTIFICATION_FALLBACK_ICON,
    messageKey: NOTIFICATION_MESSAGE_KEY[notification.type] ?? NOTIFICATION_UNKNOWN_KEY,
    params: strings,
    detail: asString(params.reason),
    link: notification.link,
  };
}

/** 句子：角色以目前的語系顯示。 */
export function notificationMessage(
  t: TranslationFacade['t'],
  notification: NotificationVM,
): string {
  const { fromKey, toKey, ...rest } = notification.params;
  return t(notification.messageKey, {
    ...rest,
    ...(fromKey && { from: t(fromKey) }),
    ...(toKey && { to: t(toKey) }),
  });
}
