import { useApprovalPermission } from '../../hooks/useApprovalPermission';
import type { ApprovalDetailVM } from './adapter';

/**
 * 這筆請求在畫面上能做什麼。權限未水合、沒有 `approval:review`、或已審核過時整塊不顯示（不閃現）；
 * 能審核但缺少該類型要求的權限（註冊 = `user:create`）時只能駁回。
 *
 * 多階段（docs/architecture/backend/20-approval.md §9）：單關的核准／駁回只在後端說可以時出現（`viewer.canReviewSingle`：
 * 單關請求，或停用期間的多關請求）；關卡的決定、強制定案、撤回看 `viewer` 的其他欄位。
 */
export function useApprovalReviewAccess(approval: ApprovalDetailVM | undefined) {
  const permission = useApprovalPermission();
  const visible = Boolean(
    approval?.isPending &&
    permission.hydrated &&
    permission.canReview &&
    approval.viewer.canReviewSingle,
  );
  const isRegistration = Boolean(approval?.registration);
  const canApprove = visible && (!isRegistration || permission.canApproveRegistration);

  const viewer = approval?.isPending ? approval.viewer : undefined;
  return {
    visible,
    canApprove,
    /** 我是目前關卡的審核者，還沒做決定。 */
    canDecide: Boolean(viewer?.canDecide),
    canOverride: Boolean(viewer?.canOverride),
    canWithdraw: Boolean(viewer?.canWithdraw),
    /** 需要填審核意見的任何操作（單關、關卡決定、強制定案）。 */
    showComment: visible || Boolean(viewer?.canDecide || viewer?.canOverride),
    /** 核准註冊時一併指派角色 */
    canAssignRole: canApprove && isRegistration && permission.canAssignRole,
  };
}
