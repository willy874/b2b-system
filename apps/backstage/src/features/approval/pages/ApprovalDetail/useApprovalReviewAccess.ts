import { useApprovalPermission } from '../../hooks/useApprovalPermission';
import type { ApprovalDetailVM } from './adapter';

/**
 * 這筆請求在畫面上能做什麼。權限未水合、沒有 `approval:review`、或已審核過時整塊不顯示（不閃現）；
 * 能審核但缺少該類型要求的權限（註冊 = `user:create`）時只能駁回。
 */
export function useApprovalReviewAccess(approval: ApprovalDetailVM | undefined) {
  const permission = useApprovalPermission();
  const visible = Boolean(approval?.isPending && permission.hydrated && permission.canReview);
  const isRegistration = Boolean(approval?.registration);
  const canApprove = visible && (!isRegistration || permission.canApproveRegistration);

  return {
    visible,
    canApprove,
    /** 核准註冊時一併指派角色 */
    canAssignRole: canApprove && isRegistration && permission.canAssignRole,
  };
}
