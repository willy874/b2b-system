import { Button } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { useTranslation } from '@b2b-system/web-core/locales';

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
  const confirm = useConfirm();
  const access = useApprovalReviewAccess(approval);

  if (!access.visible || !approval) return null;

  // 駁回無法撤回（後端會寄結果信、通知申請人）：與列表的快速駁回一樣先確認
  const confirmReject = async () => {
    const confirmed = await confirm({
      title: t('approval.quickReject.title'),
      description: t('approval.quickReject.confirm', { name: approval.requesterName }),
      confirmLabel: t('approval.reject.action'),
      tone: 'danger',
      'data-testid': 'approval-reject-confirm',
    });
    if (confirmed) await review.reject();
  };

  return (
    <>
      <Button
        variant="danger"
        loading={review.isRejecting}
        disabled={review.isPending}
        onClick={() => void confirmReject()}
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
