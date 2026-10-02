import type { ResolvedRouteLink, RouteLinkRef } from '@/core/route-link';
import type { Notification } from '@/shared/api-sdk';

import {
  APPROVAL_TYPE_FALLBACK_KEY,
  APPROVAL_TYPE_LABEL_KEY,
  NOTIFICATION_DETAIL_KEY,
  NOTIFICATION_MESSAGE_KEY,
} from './constants';

/**
 * 句子裡的一個參數：資料原樣顯示（`text`）、先翻譯再代入（`key`，例：審批類型的名稱）、
 * 或依語系串成清單（`list`，例：角色名稱）。
 */
export type MessageArg = { text: string } | { key: string } | { list: string[] };

/** 還沒翻譯的一句話：`t(key, args)`，參數依 `MessageArg` 的種類先轉成字串。 */
export interface TranslatableMessage {
  key: string;
  args: Record<string, MessageArg>;
}

/** 鈴鐺與列表頁共用的一則通知。 */
export interface NotificationVM {
  id: string;
  isRead: boolean;
  message: TranslatableMessage;
  /** 第二行起的補充（審批的摘要、增減的角色）；沒有就是空陣列。 */
  details: TranslatableMessage[];
  /** 觸發的人；null 是系統（或匿名的註冊申請）。 */
  actorName: string | null;
  createdAt: string;
  /** 解析後的連結；route id 沒有登記或缺參數時是 undefined——只顯示文字、不可點（ADR-0026 D3）。 */
  link: ResolvedRouteLink | undefined;
}

type Params = Notification['params'];

function stringParam(params: Params, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

function stringListParam(params: Params, name: string): string[] | undefined {
  const value = params[name];
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}

function approvalTypeLabel(params: Params): MessageArg {
  const type = stringParam(params, 'approvalType');
  const key =
    type && Object.hasOwn(APPROVAL_TYPE_LABEL_KEY, type)
      ? APPROVAL_TYPE_LABEL_KEY[type as keyof typeof APPROVAL_TYPE_LABEL_KEY]
      : APPROVAL_TYPE_FALLBACK_KEY;
  return { key };
}

/** 審批的摘要（顯示名稱、資料夾名稱）是使用者輸入的資料，原樣顯示；空字串（舊資料解析不了）不顯示。 */
function subjectDetail(params: Params): TranslatableMessage[] {
  const subject = stringParam(params, 'subject');
  return subject
    ? [{ key: NOTIFICATION_DETAIL_KEY.subject, args: { subject: { text: subject } } }]
    : [];
}

const UNKNOWN: Pick<NotificationVM, 'message' | 'details'> = {
  message: { key: NOTIFICATION_MESSAGE_KEY.unknown, args: {} },
  details: [],
};

/**
 * 依 `type` 組句子（docs/architecture/backend/15-notification.md §4 的參數）。
 * 不認得的類型、參數缺少或型別不對（後端改版、舊資料）都退回通用文字，不讓畫面壞掉。
 */
export function describeNotification(
  notification: Pick<Notification, 'type' | 'params'>,
): Pick<NotificationVM, 'message' | 'details'> {
  const { params } = notification;
  switch (notification.type) {
    case 'approval.pending': {
      const requester = stringParam(params, 'requesterName');
      if (!requester) return UNKNOWN;
      return {
        message: {
          key: NOTIFICATION_MESSAGE_KEY.approvalPending,
          args: { requester: { text: requester }, type: approvalTypeLabel(params) },
        },
        details: subjectDetail(params),
      };
    }
    case 'approval.result': {
      const status = stringParam(params, 'status');
      if (status !== 'approved' && status !== 'rejected') return UNKNOWN;
      return {
        message: {
          key:
            status === 'approved'
              ? NOTIFICATION_MESSAGE_KEY.approvalApproved
              : NOTIFICATION_MESSAGE_KEY.approvalRejected,
          args: { type: approvalTypeLabel(params) },
        },
        details: subjectDetail(params),
      };
    }
    case 'user.rolesChanged': {
      const added = stringListParam(params, 'added');
      const removed = stringListParam(params, 'removed');
      if (!added || !removed) return UNKNOWN;
      return {
        message: { key: NOTIFICATION_MESSAGE_KEY.userRolesChanged, args: {} },
        details: [
          ...(added.length > 0
            ? [{ key: NOTIFICATION_DETAIL_KEY.rolesAdded, args: { roles: { list: added } } }]
            : []),
          ...(removed.length > 0
            ? [{ key: NOTIFICATION_DETAIL_KEY.rolesRemoved, args: { roles: { list: removed } } }]
            : []),
        ],
      };
    }
    case 'webhook.disabled': {
      const name = stringParam(params, 'webhookName');
      const failures = params.consecutiveFailures;
      if (!name || typeof failures !== 'number') return UNKNOWN;
      return {
        message: {
          key: NOTIFICATION_MESSAGE_KEY.webhookDisabled,
          args: { name: { text: name }, count: { text: String(failures) } },
        },
        details: [],
      };
    }
    default:
      return UNKNOWN;
  }
}

export function toNotificationVM(
  notification: Notification,
  resolveLink: (link: RouteLinkRef | null) => ResolvedRouteLink | undefined,
): NotificationVM {
  return {
    id: notification.id,
    isRead: notification.readAt !== null,
    ...describeNotification(notification),
    actorName: notification.actor?.name ?? null,
    createdAt: notification.createdAt,
    link: resolveLink(notification.link),
  };
}

/** 翻譯一句話：`key` 參數先翻譯、`list` 依語系串起來（「A、B 和 C」／「A, B, and C」）。 */
export function translateMessage(
  t: (key: string, options?: Record<string, unknown>) => string,
  language: string,
  message: TranslatableMessage,
): string {
  const values: Record<string, string> = {};
  for (const [name, arg] of Object.entries(message.args)) {
    if ('text' in arg) values[name] = arg.text;
    else if ('key' in arg) values[name] = t(arg.key);
    else values[name] = formatList(language, arg.list);
  }
  return t(message.key, values);
}

function formatList(language: string, items: string[]): string {
  try {
    return new Intl.ListFormat(language, { type: 'conjunction' }).format(items);
  } catch {
    // 語系不合法（不會發生在支援的語系上）：退回逗號
    return items.join(', ');
  }
}
