import { Button } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { ApprovalDetailVM } from '../adapter';
import type { ApprovalReviewState } from '../useApprovalReview';
import { useApprovalReviewAccess } from '../useApprovalReviewAccess';

interface ApprovalOverrideActionsProps {
  approval: ApprovalDetailVM;
  review: ApprovalReviewState;
}

/**
 * 「管理員操作」（docs/architecture/backend/20-approval.md §9.8、§11.3）：`approval:override` 的人重新展開審核者、
 * 強制定案目前的關卡（意見必填）。與審核者的同意／駁回分開放，並說明它會略過原本的審核者、留下稽核。
 */
export function ApprovalOverrideActions({ approval, review }: ApprovalOverrideActionsProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const access = useApprovalReviewAccess(approval);
  const ordinal = approval.currentStep?.ordinal;
  const hasComment = review.comment.trim().length > 0;

  if (!access.canOverride || ordinal === undefined) return null;

  const confirmThen = async (
    options: { title: string; confirmLabel: string; danger?: boolean },
    action: () => Promise<unknown>,
  ) => {
    const confirmed = await confirm({
      title: options.title,
      description: t('approval.override.confirm'),
      confirmLabel: options.confirmLabel,
      tone: options.danger ? 'danger' : undefined,
      'data-testid': 'approval-chain-confirm',
    });
    if (confirmed) await action();
  };

  return (
    <section
      className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3"
      data-testid="approval-override-actions"
    >
      <h3 className="m-0 text-sm font-semibold">{t('approval.override.title')}</h3>
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t('approval.override.hint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={review.isRefreshing}
          disabled={review.isPending}
          onClick={() => void review.refresh(ordinal)}
          data-testid="approval-refresh-button"
        >
          {t('approval.refresh.action')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={review.isPending || !hasComment}
          title={hasComment ? undefined : t('approval.override.commentRequired')}
          onClick={() =>
            void confirmThen(
              {
                title: t('approval.override.rejectTitle'),
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
          size="sm"
          disabled={review.isPending || !hasComment}
          title={hasComment ? undefined : t('approval.override.commentRequired')}
          loading={review.isOverriding}
          onClick={() =>
            void confirmThen(
              {
                title: t('approval.override.approveTitle'),
                confirmLabel: t('approval.override.approve'),
              },
              () => review.override(ordinal, 'approve'),
            )
          }
          data-testid="approval-override-approve-button"
        >
          {t('approval.override.approve')}
        </Button>
      </div>
    </section>
  );
}
