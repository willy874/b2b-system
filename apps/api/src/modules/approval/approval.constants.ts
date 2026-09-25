import { PERMISSION } from '@/common/types';

export const APPROVAL_PERMISSIONS = {
  READ: PERMISSION.APPROVAL_READ,
  REVIEW: PERMISSION.APPROVAL_REVIEW,
} as const;

/**
 * 需要審批的變更類型。新增一種類型 = 在這裡加一個值 ＋ 在負責的模組實作並註冊一個
 * `ApprovalHandler`（docs/rbac/06-approval.md §4）。
 */
export const ApprovalType = {
  USER_REGISTER: 'user.register',
} as const;

export type ApprovalType = (typeof ApprovalType)[keyof typeof ApprovalType];

export const APPROVAL_TYPES = Object.values(ApprovalType) as [ApprovalType, ...ApprovalType[]];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;

/** 待審去重鍵的唯一索引名稱：併發送出同一筆請求時，由它擋下第二筆。 */
export const PENDING_SUBJECT_CONSTRAINT = 'approval_requests_pending_subject_key';
