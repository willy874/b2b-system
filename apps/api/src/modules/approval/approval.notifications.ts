import {
  defineNotification,
  NotificationChannel,
} from '@/modules/notification/notification.definition';
import type {
  AnyNotificationType,
  NotificationLink,
} from '@/modules/notification/notification.definition';

import type { ApprovalType } from './approval.constants';

/**
 * 審批的站內通知（docs/architecture/backend/15-notification.md §4、docs/architecture/backend/15-notification.md §12.2 D11）。
 * 參數是名稱快照：之後請求被審核、申請人改名都不影響已送出的通知。
 */

/** 有待審的請求：給送出當下持有 `approval:review` 的人（不含申請人自己）。 */
export type ApprovalPendingParams = {
  approvalType: ApprovalType;
  /** 申請人（註冊是填寫的 email，其他是申請人的 email）。 */
  requesterName: string;
  /** 一行摘要（由該類型的 handler 提供：註冊是顯示名稱、資料夾存取是資料夾名稱）。 */
  subject: string;
  /** 多階段：輪到的關卡名稱（docs/architecture/backend/20-approval.md §9.15）；單關請求沒有。 */
  stepName?: string;
};

export const APPROVAL_PENDING_NOTIFICATION = defineNotification<ApprovalPendingParams>(
  'approval.pending',
  { category: 'approval', channels: [NotificationChannel.IN_APP] },
);

/** 請求被核准或駁回：給申請人（匿名的註冊沒有收件人；結果信照舊）。 */
export type ApprovalResultParams = {
  approvalType: ApprovalType;
  subject: string;
  status: 'approved' | 'rejected';
};

/**
 * 結果信（`approval.resultMail`）也是這個事件的 `email` 管道（docs/architecture/backend/16-notification-event.md §9.2 D3）：租戶可以分別關掉站內通知與信。
 */
export const APPROVAL_RESULT_NOTIFICATION = defineNotification<ApprovalResultParams>(
  'approval.result',
  { category: 'approval', channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL] },
);

/** 多階段：一關通過、往下一關（給申請人；docs/architecture/backend/20-approval.md §9.15）。 */
export type ApprovalProgressParams = {
  approvalType: ApprovalType;
  subject: string;
  /** 剛通過的關卡。 */
  stepName: string;
  /** 接下來的關卡。 */
  nextStepName: string;
};

export const APPROVAL_PROGRESS_NOTIFICATION = defineNotification<ApprovalProgressParams>(
  'approval.progress',
  { category: 'approval', channels: [NotificationChannel.IN_APP], feature: 'approvalChain' },
);

/** 多階段：關卡啟動時找不到（足夠的）審核者，給持有 `approval:override` 的人（D9）。 */
export type ApprovalUnassignedParams = {
  approvalType: ApprovalType;
  subject: string;
  stepName: string;
  shortage: 'noCandidate' | 'insufficient';
};

export const APPROVAL_UNASSIGNED_NOTIFICATION = defineNotification<ApprovalUnassignedParams>(
  'approval.unassigned',
  { category: 'approval', channels: [NotificationChannel.IN_APP], feature: 'approvalChain' },
);

/** `ApprovalModule` 登記進事件目錄的類型。 */
export const APPROVAL_NOTIFICATIONS: readonly AnyNotificationType[] = [
  APPROVAL_PENDING_NOTIFICATION,
  APPROVAL_RESULT_NOTIFICATION,
  APPROVAL_PROGRESS_NOTIFICATION,
  APPROVAL_UNASSIGNED_NOTIFICATION,
];

/** 審批詳情（前端 `/approval/$approvalId`；需要 `approval:read`）。 */
export function approvalDetailLink(approvalId: string): NotificationLink {
  return { route: 'approval.detail', params: { approvalId } };
}

/**
 * 「我的審批」的詳情（前端 `/my-approvals/$approvalId`）：申請人與關卡的審核者沒有 `approval:read` 也打得開
 * （docs/architecture/backend/20-approval.md §9.10）。
 */
export function approvalTaskLink(approvalId: string): NotificationLink {
  return { route: 'approval.myDetail', params: { approvalId } };
}
