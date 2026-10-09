import type { IconName } from '@b2b-system/ui/Icon';

import type {
  ApprovalType,
  NotificationChannel,
  NotificationPreferenceChannel,
} from '@/shared/api-sdk';

/**
 * 通知句子的 i18n key：依後端的 `type`（與參數）挑選，一律是完整字面量（docs/coding-standards/06-literal-strings.md §3.1）。
 * 新增一種通知時在這裡加一列、兩個語系檔加句子（docs/architecture/backend/15-notification.md §9）。
 */
export const NOTIFICATION_MESSAGE_KEY = {
  approvalPending: 'notification.message.approvalPending',
  approvalApproved: 'notification.message.approvalApproved',
  approvalRejected: 'notification.message.approvalRejected',
  /** 多階段：輪到某一關（docs/architecture/backend/20-approval.md §9.15）。 */
  approvalPendingStep: 'notification.message.approvalPendingStep',
  approvalProgress: 'notification.message.approvalProgress',
  approvalUnassigned: 'notification.message.approvalUnassigned',
  userRolesChanged: 'notification.message.userRolesChanged',
  webhookDisabled: 'notification.message.webhookDisabled',
  announcementPublished: 'notification.message.announcementPublished',
  /** 留言與關注（docs/architecture/backend/24-comment.md §4）。 */
  commentMentioned: 'notification.message.commentMentioned',
  commentCreated: 'notification.message.commentCreated',
  watchResourceUpdated: 'notification.message.watchResourceUpdated',
  /** 匯入／匯出（docs/architecture/backend/22-data-transfer.md §9.3）：依 `params.status` 分完成與失敗。 */
  dataTransferExportCompleted: 'notification.message.dataTransferExportCompleted',
  dataTransferExportFailed: 'notification.message.dataTransferExportFailed',
  dataTransferImportCompleted: 'notification.message.dataTransferImportCompleted',
  dataTransferImportFailed: 'notification.message.dataTransferImportFailed',
  /** 不認得的 `type`（前端比後端舊）或參數不合預期：只說有一則通知。 */
  unknown: 'notification.message.unknown',
} as const;

/** 句子第二行的 key。 */
export const NOTIFICATION_DETAIL_KEY = {
  /** 審批的一行摘要（申請人填的顯示名稱、資料夾名稱），原樣顯示。 */
  subject: 'notification.detail.subject',
  rolesAdded: 'notification.detail.rolesAdded',
  rolesRemoved: 'notification.detail.rolesRemoved',
  /** 留言的前幾個字，原樣顯示。 */
  excerpt: 'notification.detail.excerpt',
  /** 匯入套用的結果筆數。 */
  importCounts: 'notification.detail.importCounts',
  /** 失敗的錯誤碼不認得時（後端比前端新）；認得的用 `error.<CODE>`。 */
  dataTransferError: 'notification.detail.dataTransferError',
} as const;

/** 審批類型的名稱；後端新增類型而這裡沒跟上時編譯失敗。 */
export const APPROVAL_TYPE_LABEL_KEY = {
  'user.register': 'notification.approvalType.userRegister',
  'fileFolder.access': 'notification.approvalType.fileFolderAccess',
} as const satisfies Record<ApprovalType, string>;

/** 參數裡的審批類型不認得時（舊通知、後端比前端新）。 */
export const APPROVAL_TYPE_FALLBACK_KEY = 'notification.approvalType.unknown';

/** 留言與關注的通知裡，資源類型的名詞（`params.resourceType`，docs/architecture/backend/24-comment.md §4）。 */
export const RESOURCE_TYPE_LABEL_KEY: Readonly<Partial<Record<string, string>>> = {
  user: 'notification.resourceType.user',
};

/** 不認得的資源類型（後端比前端新）。 */
export const RESOURCE_TYPE_FALLBACK_KEY = 'notification.resourceType.unknown';

/**
 * 匯入匯出的通知裡，資源的名稱（`params.type`，後端各資源以 `defineTransferResource` 登記的 `type`）。
 * 後端新增資源而這裡沒補時退回 `DATA_TRANSFER_RESOURCE_FALLBACK_KEY`。
 */
export const DATA_TRANSFER_RESOURCE_LABEL_KEY: Readonly<Partial<Record<string, string>>> = {
  user: 'notification.dataTransferResource.user',
  role: 'notification.dataTransferResource.role',
  group: 'notification.dataTransferResource.group',
  groupMember: 'notification.dataTransferResource.groupMember',
  orgUnit: 'notification.dataTransferResource.orgUnit',
  orgUnitMember: 'notification.dataTransferResource.orgUnitMember',
  tag: 'notification.dataTransferResource.tag',
  serviceAccount: 'notification.dataTransferResource.serviceAccount',
  approvalRequest: 'notification.dataTransferResource.approvalRequest',
  approvalDecision: 'notification.dataTransferResource.approvalDecision',
  auditLog: 'notification.dataTransferResource.auditLog',
};

export const DATA_TRANSFER_RESOURCE_FALLBACK_KEY = 'notification.dataTransferResource.unknown';

/** 每種通知的圖示（依後端的 `type`）；不認得的類型用鈴鐺。 */
export const NOTIFICATION_ICON = {
  'approval.pending': 'flag',
  'approval.result': 'shield',
  'approval.progress': 'flag',
  'approval.unassigned': 'warning',
  'user.rolesChanged': 'user',
  'webhook.disabled': 'warning',
  'announcement.published': 'megaphone',
  'comment.mentioned': 'circle-user',
  'comment.created': 'edit',
  'watch.resourceUpdated': 'refresh',
  'dataTransfer.exportFinished': 'download',
  'dataTransfer.importFinished': 'upload',
} as const satisfies Record<string, IconName>;

export const NOTIFICATION_FALLBACK_ICON: IconName = 'bell';

/** 每頁幾筆（鈴鐺與列表頁共用同一個 query）。 */
export const NOTIFICATION_PAGE_SIZE = 20;

/** 通知總覽一次載入幾筆（「載入更多」）。 */
export const NOTIFICATION_OVERVIEW_PAGE_SIZE = 50;

/** 徽章最多顯示到這個數字，超過顯示「99+」。 */
export const NOTIFICATION_BADGE_MAX = 99;

// ── 事件管理（docs/architecture/backend/16-notification-event.md §9.2 D13） ──────────────────────────────

/** 一個事件在管理頁的名稱、說明與「誰會收到」。 */
export interface NotificationEventLabel {
  nameKey: string;
  descriptionKey: string;
  recipientsKey: string;
}

/**
 * 事件的顯示文字（key 與後端的 `type` 相同）。後端新增了這裡沒有的事件時，管理頁以 `type` 本身當名稱，開關照常可用。
 * 新增一種通知時在這裡加一列（docs/architecture/backend/15-notification.md §9）。
 */
export const NOTIFICATION_EVENT_LABEL: Readonly<Partial<Record<string, NotificationEventLabel>>> = {
  'approval.pending': {
    nameKey: 'notification.event.type.approvalPending.name',
    descriptionKey: 'notification.event.type.approvalPending.description',
    recipientsKey: 'notification.event.type.approvalPending.recipients',
  },
  'approval.result': {
    nameKey: 'notification.event.type.approvalResult.name',
    descriptionKey: 'notification.event.type.approvalResult.description',
    recipientsKey: 'notification.event.type.approvalResult.recipients',
  },
  'approval.progress': {
    nameKey: 'notification.event.type.approvalProgress.name',
    descriptionKey: 'notification.event.type.approvalProgress.description',
    recipientsKey: 'notification.event.type.approvalProgress.recipients',
  },
  'approval.unassigned': {
    nameKey: 'notification.event.type.approvalUnassigned.name',
    descriptionKey: 'notification.event.type.approvalUnassigned.description',
    recipientsKey: 'notification.event.type.approvalUnassigned.recipients',
  },
  'user.rolesChanged': {
    nameKey: 'notification.event.type.userRolesChanged.name',
    descriptionKey: 'notification.event.type.userRolesChanged.description',
    recipientsKey: 'notification.event.type.userRolesChanged.recipients',
  },
  'webhook.disabled': {
    nameKey: 'notification.event.type.webhookDisabled.name',
    descriptionKey: 'notification.event.type.webhookDisabled.description',
    recipientsKey: 'notification.event.type.webhookDisabled.recipients',
  },
  'announcement.published': {
    nameKey: 'notification.event.type.announcementPublished.name',
    descriptionKey: 'notification.event.type.announcementPublished.description',
    recipientsKey: 'notification.event.type.announcementPublished.recipients',
  },
  'comment.mentioned': {
    nameKey: 'notification.event.type.commentMentioned.name',
    descriptionKey: 'notification.event.type.commentMentioned.description',
    recipientsKey: 'notification.event.type.commentMentioned.recipients',
  },
  'comment.created': {
    nameKey: 'notification.event.type.commentCreated.name',
    descriptionKey: 'notification.event.type.commentCreated.description',
    recipientsKey: 'notification.event.type.commentCreated.recipients',
  },
  'watch.resourceUpdated': {
    nameKey: 'notification.event.type.watchResourceUpdated.name',
    descriptionKey: 'notification.event.type.watchResourceUpdated.description',
    recipientsKey: 'notification.event.type.watchResourceUpdated.recipients',
  },
  'dataTransfer.exportFinished': {
    nameKey: 'notification.event.type.dataTransferExportFinished.name',
    descriptionKey: 'notification.event.type.dataTransferExportFinished.description',
    recipientsKey: 'notification.event.type.dataTransferExportFinished.recipients',
  },
  'dataTransfer.importFinished': {
    nameKey: 'notification.event.type.dataTransferImportFinished.name',
    descriptionKey: 'notification.event.type.dataTransferImportFinished.description',
    recipientsKey: 'notification.event.type.dataTransferImportFinished.recipients',
  },
};

/** 分類的標題；不認得的分類以分類名稱本身顯示。 */
export const NOTIFICATION_EVENT_CATEGORY_LABEL_KEY: Readonly<Partial<Record<string, string>>> = {
  approval: 'notification.event.category.approval',
  user: 'notification.event.category.user',
  webhook: 'notification.event.category.webhook',
  announcement: 'notification.event.category.announcement',
  comment: 'notification.event.category.comment',
  dataTransfer: 'notification.event.category.dataTransfer',
};

/** 管道的名稱；後端新增管道而這裡沒跟上時編譯失敗。 */
export const NOTIFICATION_CHANNEL_LABEL_KEY = {
  inApp: 'notification.event.channel.inApp',
  email: 'notification.event.channel.email',
} as const satisfies Record<NotificationChannel, string>;

/** 個人設定不能調整的原因（docs/architecture/backend/16-notification-event.md §9.2 D14）；後端新增原因而這裡沒跟上時編譯失敗。 */
export const NOTIFICATION_PREFERENCE_LOCK_LABEL_KEY = {
  mandatory: 'notification.preference.lock.mandatory',
  tenantDisabled: 'notification.preference.lock.tenantDisabled',
  tenantRequired: 'notification.preference.lock.tenantRequired',
} as const satisfies Record<NonNullable<NotificationPreferenceChannel['lock']>, string>;
