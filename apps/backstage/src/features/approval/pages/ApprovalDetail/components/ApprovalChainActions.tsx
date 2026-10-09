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
 * 詳情的操作區裡，多階段的決定與撤回（docs/architecture/backend/20-approval.md §9.7、§9.9）：
 * 目前關卡的審核者同意／駁回；申請人撤回。單關的核准／駁回在 `ApprovalReviewActions`，
 * 重新展開審核者與強制定案在「管理員操作」（`ApprovalOverrideActions`）。
 */
export function ApprovalChainActions({ approval, review }: ApprovalChainActionsProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const access = useApprovalReviewAccess(approval);
  const ordinal = approval?.currentStep?.ordinal;

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
