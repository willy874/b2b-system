import type { IconName } from '@b2b-system/ui/Icon';
import { getErrorMessageKey } from '@b2b-system/web-core/errors';
import type { ResolvedRouteLink, RouteLinkRef } from '@b2b-system/web-core/route-link';

import type { Notification } from '@/shared/api-sdk';

import {
  APPROVAL_TYPE_FALLBACK_KEY,
  APPROVAL_TYPE_LABEL_KEY,
  DATA_TRANSFER_RESOURCE_FALLBACK_KEY,
  DATA_TRANSFER_RESOURCE_LABEL_KEY,
  NOTIFICATION_DETAIL_KEY,
  NOTIFICATION_FALLBACK_ICON,
  NOTIFICATION_ICON,
  NOTIFICATION_MESSAGE_KEY,
  RESOURCE_TYPE_FALLBACK_KEY,
  RESOURCE_TYPE_LABEL_KEY,
} from './constants';

/**
 * 句子裡的一個參數：資料原樣顯示（`text`）、數量（`count`，原樣傳給 `t()` 才會選到複數形）、
 * 先翻譯再代入（`key`，例：審批類型的名稱）、或依語系串成清單（`list`，例：角色名稱）。
 */
export type MessageArg =
  | { text: string }
  | { count: number }
  | { key: string }
  | { list: string[] };

/** 還沒翻譯的一句話：`t(key, args)`，參數依 `MessageArg` 的種類先轉成字串。 */
export interface TranslatableMessage {
  key: string;
  args: Record<string, MessageArg>;
}

/** 鈴鐺與列表頁共用的一則通知。 */
export interface NotificationVM {
  id: string;
  isRead: boolean;
  /** 依類型的圖示，讓列表一眼看得出是哪一類事件。 */
  icon: IconName;
  message: TranslatableMessage;
  /** 第二行起的補充（審批的摘要、增減的角色）；沒有就是空陣列。 */
  details: TranslatableMessage[];
  /** 觸發的人；null 是系統（或匿名的註冊申請）。 */
  actorName: string | null;
  createdAt: string;
  /** 解析後的連結；route id 沒有登記或缺參數時是 undefined——只顯示文字、不可點（docs/architecture/backend/15-notification.md §12.2 D3）。 */
  link: ResolvedRouteLink | undefined;
}

type Params = Notification['params'];

function stringParam(params: Params, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

function numberParam(params: Params, name: string): number | undefined {
  const value = params[name];
  return typeof value === 'number' ? value : undefined;
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

function resourceTypeLabel(params: Params): MessageArg {
  const type = stringParam(params, 'resourceType');
  // 舊通知、後端比前端新時不認得：退回「項目」
  const key =
    type && Object.hasOwn(RESOURCE_TYPE_LABEL_KEY, type)
      ? RESOURCE_TYPE_LABEL_KEY[type as keyof typeof RESOURCE_TYPE_LABEL_KEY]
      : RESOURCE_TYPE_FALLBACK_KEY;
  return { key };
}

/** 留言與關注：資源的名詞與名稱；留言的通知另帶摘要（使用者輸入的資料，原樣顯示）。 */
function describeWatched(
  params: Params,
  key: string,
  withExcerpt: boolean,
): Pick<NotificationVM, 'message' | 'details'> | undefined {
  const name = stringParam(params, 'resourceName');
  if (name === undefined) return undefined;
  const excerpt = withExcerpt ? stringParam(params, 'excerpt') : undefined;
  return {
    message: { key, args: { resourceType: resourceTypeLabel(params), name: { text: name } } },
    details: excerpt
      ? [{ key: NOTIFICATION_DETAIL_KEY.excerpt, args: { excerpt: { text: excerpt } } }]
      : [],
  };
}

function dataTransferResourceLabel(params: Params): MessageArg {
  const type = stringParam(params, 'type');
  return {
    key: (type && DATA_TRANSFER_RESOURCE_LABEL_KEY[type]) || DATA_TRANSFER_RESOURCE_FALLBACK_KEY,
  };
}

/** 失敗的原因：認得的錯誤碼用共用的錯誤訊息，不認得的（後端比前端新）用通用的一句；沒有錯誤碼不顯示。 */
function dataTransferErrorDetail(params: Params): TranslatableMessage[] {
  const code = stringParam(params, 'errorCode');
  if (!code) return [];
  return [{ key: getErrorMessageKey(code) ?? NOTIFICATION_DETAIL_KEY.dataTransferError, args: {} }];
}

/** 匯入匯出完成或失敗（docs/architecture/backend/22-data-transfer.md §9.3）；`status` 只會是 `completed`／`failed`。 */
function describeDataTransfer(
  params: Params,
  direction: 'export' | 'import',
): Pick<NotificationVM, 'message' | 'details'> | undefined {
  const status = stringParam(params, 'status');
  const resourceType = dataTransferResourceLabel(params);
  if (status === 'failed') {
    return {
      message: {
        key:
          direction === 'export'
            ? NOTIFICATION_MESSAGE_KEY.dataTransferExportFailed
            : NOTIFICATION_MESSAGE_KEY.dataTransferImportFailed,
        args: { resourceType },
      },
      details: dataTransferErrorDetail(params),
    };
  }
  if (status !== 'completed') return undefined;
  if (direction === 'export') {
    const rows = numberParam(params, 'rows');
    if (rows === undefined) return undefined;
    return {
      message: {
        key: NOTIFICATION_MESSAGE_KEY.dataTransferExportCompleted,
        args: { resourceType, count: { count: rows } },
      },
      details: [],
    };
  }
  const succeeded = numberParam(params, 'succeeded');
  const failed = numberParam(params, 'failed');
  const skipped = numberParam(params, 'skipped');
  if (succeeded === undefined || failed === undefined || skipped === undefined) return undefined;
  return {
    message: { key: NOTIFICATION_MESSAGE_KEY.dataTransferImportCompleted, args: { resourceType } },
    details: [
      {
        key: NOTIFICATION_DETAIL_KEY.importCounts,
        args: {
          succeeded: { text: String(succeeded) },
          failed: { text: String(failed) },
          skipped: { text: String(skipped) },
        },
      },
    ],
  };
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
      // 多階段的關卡帶 stepName（docs/architecture/backend/20-approval.md §9.15）
      const step = stringParam(params, 'stepName');
      return {
        message: step
          ? {
              key: NOTIFICATION_MESSAGE_KEY.approvalPendingStep,
              args: {
                requester: { text: requester },
                type: approvalTypeLabel(params),
                step: { text: step },
              },
            }
          : {
              key: NOTIFICATION_MESSAGE_KEY.approvalPending,
              args: { requester: { text: requester }, type: approvalTypeLabel(params) },
            },
        details: subjectDetail(params),
      };
    }
    case 'approval.progress': {
      const step = stringParam(params, 'stepName');
      const next = stringParam(params, 'nextStepName');
      if (!step || !next) return UNKNOWN;
      return {
        message: {
          key: NOTIFICATION_MESSAGE_KEY.approvalProgress,
          args: { type: approvalTypeLabel(params), step: { text: step }, next: { text: next } },
        },
        details: subjectDetail(params),
      };
    }
    case 'approval.unassigned': {
      const step = stringParam(params, 'stepName');
      if (!step) return UNKNOWN;
      return {
        message: {
          key: NOTIFICATION_MESSAGE_KEY.approvalUnassigned,
          args: { type: approvalTypeLabel(params), step: { text: step } },
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
          args: { name: { text: name }, count: { count: failures } },
        },
        details: [],
      };
    }
    case 'announcement.published': {
      const title = stringParam(params, 'title');
      if (!title) return UNKNOWN;
      return {
        message: {
          key: NOTIFICATION_MESSAGE_KEY.announcementPublished,
          args: { title: { text: title } },
        },
        details: [],
      };
    }
    case 'comment.mentioned':
      return describeWatched(params, NOTIFICATION_MESSAGE_KEY.commentMentioned, true) ?? UNKNOWN;
    case 'comment.created':
      return describeWatched(params, NOTIFICATION_MESSAGE_KEY.commentCreated, true) ?? UNKNOWN;
    case 'watch.resourceUpdated':
      return (
        describeWatched(params, NOTIFICATION_MESSAGE_KEY.watchResourceUpdated, false) ?? UNKNOWN
      );
    case 'dataTransfer.exportFinished':
      return describeDataTransfer(params, 'export') ?? UNKNOWN;
    case 'dataTransfer.importFinished':
      return describeDataTransfer(params, 'import') ?? UNKNOWN;
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
    icon: Object.hasOwn(NOTIFICATION_ICON, notification.type)
      ? NOTIFICATION_ICON[notification.type as keyof typeof NOTIFICATION_ICON]
      : NOTIFICATION_FALLBACK_ICON,
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
  const values: Record<string, string | number> = {};
  for (const [name, arg] of Object.entries(message.args)) {
    if ('text' in arg) values[name] = arg.text;
    else if ('count' in arg) values[name] = arg.count;
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
