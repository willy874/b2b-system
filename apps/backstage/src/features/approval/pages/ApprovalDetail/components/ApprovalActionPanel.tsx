import { FormError } from '@b2b-system/ui/FormError';

import type { Role } from '@/shared/api-sdk';

import type { ApprovalDetailVM } from '../adapter';
import type { ApprovalReviewState } from '../useApprovalReview';
import { useApprovalReviewAccess } from '../useApprovalReviewAccess';
import { ApprovalChainActions } from './ApprovalChainActions';
import { ApprovalOverrideActions } from './ApprovalOverrideActions';
import { ApprovalReviewActions } from './ApprovalReviewActions';
import { ApprovalReviewForm } from './ApprovalReviewForm';

interface ApprovalActionPanelProps {
  approval: ApprovalDetailVM;
  review: ApprovalReviewState;
  roleOptions: Role[] | undefined;
}

/**
 * 詳情右欄的操作區（docs/architecture/backend/20-approval.md §11.3）：只放 **目前這個人能做的**——
 * 審核意見與角色、同意／駁回（或單關的核准／駁回）、申請人的撤回；`approval:override` 的「管理員操作」另成一段。
 * 什麼都不能做時整塊不渲染。
 */
export function ApprovalActionPanel({ approval, review, roleOptions }: ApprovalActionPanelProps) {
  const access = useApprovalReviewAccess(approval);
  if (!access.showComment && !access.canWithdraw && !access.canOverride) return null;

  return (
    <section
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      data-testid="approval-action-panel"
    >
      <ApprovalReviewForm approval={approval} review={review} roleOptions={roleOptions} />
      {/* 審核表單裡已經有錯誤訊息；只有撤回時沒有表單 */}
      {!access.showComment && <FormError data-testid="approval-error">{review.error}</FormError>}
      <div className="flex flex-wrap justify-end gap-2 empty:hidden">
        <ApprovalChainActions approval={approval} review={review} />
        <ApprovalReviewActions approval={approval} review={review} />
      </div>
      <ApprovalOverrideActions approval={approval} review={review} />
    </section>
  );
}
