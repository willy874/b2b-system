import { Button } from '@/components/Button';
import { useTranslation } from '@/core/locales';

import type { ApprovalDetailVM } from '../adapter';
import type { ApprovalReviewState } from '../useApprovalReview';
import { useApprovalReviewAccess } from '../useApprovalReviewAccess';

interface ApprovalReviewActionsProps {
  approval: ApprovalDetailVM | undefined;
  review: ApprovalReviewState;
}

/** 對話框 footer 的駁回／核准：固定在底部，角色很多時也不用捲動才找得到。 */
export function ApprovalReviewActions({ approval, review }: ApprovalReviewActionsProps) {
  const { t } = useTranslation();
  const access = useApprovalReviewAccess(approval);

  if (!access.visible) return null;

  return (
    <>
      <Button
        variant="danger"
        loading={review.isRejecting}
        disabled={review.isPending}
        onClick={() => void review.reject()}
        data-testid="approval-reject-button"
      >
        {t('approval.reject.action')}
      </Button>
      <Button
        variant="primary"
        loading={review.isApproving}
        disabled={!access.canApprove || review.isPending}
        onClick={() => void review.approve()}
        data-testid="approval-approve-button"
      >
        {t('approval.approve.action')}
      </Button>
    </>
  );
}
