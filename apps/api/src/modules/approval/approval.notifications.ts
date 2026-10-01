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
 * 審批的站內通知（docs/architecture/backend/15-notification.md §4、ADR-0026 D11）。
 * 參數是名稱快照：之後請求被審核、申請人改名都不影響已送出的通知。
 */

/** 有待審的請求：給送出當下持有 `approval:review` 的人（不含申請人自己）。 */
export type ApprovalPendingParams = {
  approvalType: ApprovalType;
  /** 申請人（註冊是填寫的 email，其他是申請人的 email）。 */
  requesterName: string;
  /** 一行摘要（由該類型的 handler 提供：註冊是顯示名稱、資料夾存取是資料夾名稱）。 */
  subject: string;
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
 * 結果信（`approval.resultMail`）也是這個事件的 `email` 管道（ADR-0028 D3）：租戶可以分別關掉站內通知與信。
 */
export const APPROVAL_RESULT_NOTIFICATION = defineNotification<ApprovalResultParams>(
  'approval.result',
  { category: 'approval', channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL] },
);

/** `ApprovalModule` 登記進事件目錄的類型。 */
export const APPROVAL_NOTIFICATIONS: readonly AnyNotificationType[] = [
  APPROVAL_PENDING_NOTIFICATION,
  APPROVAL_RESULT_NOTIFICATION,
];

/** 審批詳情（前端 `/approval/$approvalId`）。 */
export function approvalDetailLink(approvalId: string): NotificationLink {
  return { route: 'approval.detail', params: { approvalId } };
}
