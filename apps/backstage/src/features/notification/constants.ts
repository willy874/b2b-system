import type { ApprovalType } from '@/shared/api-sdk';

/**
 * 通知句子的 i18n key：依後端的 `type`（與參數）挑選，一律是完整字面量（docs/conventions/06-literal-strings.md §3.1）。
 * 新增一種通知時在這裡加一列、兩個語系檔加句子（docs/architecture/backend/15-notification.md §9）。
 */
export const NOTIFICATION_MESSAGE_KEY = {
  approvalPending: 'notification.message.approvalPending',
  approvalApproved: 'notification.message.approvalApproved',
  approvalRejected: 'notification.message.approvalRejected',
  userRolesChanged: 'notification.message.userRolesChanged',
  /** 不認得的 `type`（前端比後端舊）或參數不合預期：只說有一則通知。 */
  unknown: 'notification.message.unknown',
} as const;

/** 句子第二行的 key。 */
export const NOTIFICATION_DETAIL_KEY = {
  /** 審批的一行摘要（申請人填的顯示名稱、資料夾名稱），原樣顯示。 */
  subject: 'notification.detail.subject',
  rolesAdded: 'notification.detail.rolesAdded',
  rolesRemoved: 'notification.detail.rolesRemoved',
} as const;

/** 審批類型的名稱；後端新增類型而這裡沒跟上時編譯失敗。 */
export const APPROVAL_TYPE_LABEL_KEY = {
  'user.register': 'notification.approvalType.userRegister',
  'fileFolder.access': 'notification.approvalType.fileFolderAccess',
} as const satisfies Record<ApprovalType, string>;

/** 參數裡的審批類型不認得時（舊通知、後端比前端新）。 */
export const APPROVAL_TYPE_FALLBACK_KEY = 'notification.approvalType.unknown';

/** 每頁幾筆（鈴鐺與列表頁共用同一個 query）。 */
export const NOTIFICATION_PAGE_SIZE = 20;

/** 徽章最多顯示到這個數字，超過顯示「99+」。 */
export const NOTIFICATION_BADGE_MAX = 99;
