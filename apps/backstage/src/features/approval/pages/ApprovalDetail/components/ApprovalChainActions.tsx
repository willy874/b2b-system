import { Button } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { ApprovalDetailVM } from '../adapter';
import type { ApprovalReviewState } from '../useApprovalReview';
import { useApprovalReviewAccess } from '../useApprovalReviewAccess';

interface ApprovalChainActionsProps {
  approval: ApprovalDetailVM | undefined;
  review: ApprovalReviewState;
}

/**
 * 對話框 footer 的多階段操作與撤回（docs/architecture/backend/20-approval.md §9.7～§9.9）：
 * 目前關卡的審核者同意／駁回；`approval:override` 的人重新展開審核者、強制定案（意見必填）；申請人撤回。
 * 單關的核准／駁回在 `ApprovalReviewActions`。
 */
export function ApprovalChainActions({ approval, review }: ApprovalChainActionsProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const access = useApprovalReviewAccess(approval);
  const ordinal = approval?.currentStep?.ordinal;
  const hasComment = review.comment.trim().length > 0;

  if (!approval) return null;

  const confirmThen = async (
    options: { title: string; description: string; confirmLabel: string; danger?: boolean },
    action: () => Promise<unknown>,
  ) => {
    const confirmed = await confirm({
      title: options.title,
      description: options.description,
      confirmLabel: options.confirmLabel,
      tone: options.danger ? 'danger' : undefined,
      'data-testid': 'approval-chain-confirm',
    });
    if (confirmed) await action();
  };

  return (
    <>
      {access.canWithdraw && (
        <Button
          loading={review.isWithdrawing}
          disabled={review.isPending}
          onClick={() =>
            void confirmThen(
              {
                title: t('approval.withdraw.title'),
                description: t('approval.withdraw.confirm'),
                confirmLabel: t('approval.withdraw.action'),
                danger: true,
              },
              review.withdraw,
            )
          }
          data-testid="approval-withdraw-button"
        >
          {t('approval.withdraw.action')}
        </Button>
      )}
      {access.canOverride && ordinal !== undefined && (
        <>
          <Button
            loading={review.isRefreshing}
            disabled={review.isPending}
            onClick={() => void review.refresh(ordinal)}
            data-testid="approval-refresh-button"
          >
            {t('approval.refresh.action')}
          </Button>
          <Button
            variant="danger"
            disabled={review.isPending || !hasComment}
            title={hasComment ? undefined : t('approval.override.commentRequired')}
            onClick={() =>
              void confirmThen(
                {
                  title: t('approval.override.rejectTitle'),
                  description: t('approval.override.confirm'),
                  confirmLabel: t('approval.override.reject'),
                  danger: true,
                },
                () => review.override(ordinal, 'reject'),
              )
            }
            data-testid="approval-override-reject-button"
          >
            {t('approval.override.reject')}
          </Button>
          <Button
            disabled={review.isPending || !hasComment}
            title={hasComment ? undefined : t('approval.override.commentRequired')}
            loading={review.isOverriding}
            onClick={() =>
              void confirmThen(
                {
                  title: t('approval.override.approveTitle'),
                  description: t('approval.override.confirm'),
                  confirmLabel: t('approval.override.approve'),
                },
                () => review.override(ordinal, 'approve'),
              )
            }
            data-testid="approval-override-approve-button"
          >
            {t('approval.override.approve')}
          </Button>
        </>
      )}
      {access.canDecide && ordinal !== undefined && (
        <>
          <Button
            variant="danger"
            loading={review.isRejecting}
            disabled={review.isPending}
            onClick={() =>
              void confirmThen(
                {
                  title: t('approval.quickReject.title'),
                  description: t('approval.quickReject.confirm', { name: approval.requesterName }),
                  confirmLabel: t('approval.reject.action'),
                  danger: true,
                },
                () => review.decide(ordinal, 'reject'),
              )
            }
            data-testid="approval-step-reject-button"
          >
            {t('approval.reject.action')}
          </Button>
          <Button
            variant="primary"
            loading={review.isApproving}
            disabled={review.isPending}
            onClick={() => void review.decide(ordinal, 'approve')}
            data-testid="approval-step-approve-button"
          >
            {t('approval.step.approve')}
          </Button>
        </>
      )}
    </>
  );
}
