import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import type { IconName } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';

import type { ApprovalDetailVM } from '../adapter';
import { useApprovalOutcome } from '../useApprovalOutcome';
import { useApprovalReviewAccess } from '../useApprovalReviewAccess';
import { ApprovalResubmitLink } from './ApprovalResubmitLink';

interface ApprovalStatusBannerProps {
  approval: ApprovalDetailVM;
  /** 目前的登入者是申請人（撤回後、被駁回後的說明與「修改後重新送出」）。 */
  isRequester: boolean;
  /** 打開另一筆審批（重新送出的前一筆或新的一筆），留在同一個列表脈絡裡。 */
  onOpenApproval: (approvalId: string) => void;
}

type BannerTone = 'info' | 'warning' | 'success' | 'danger' | 'neutral';

const BANNER_CLASS = {
  info: 'border-[var(--color-brand)]',
  warning: 'border-[var(--color-warning)]',
  success: 'border-[var(--color-success)]',
  danger: 'border-[var(--color-danger)]',
  neutral: 'border-[var(--color-border)]',
} as const satisfies Record<BannerTone, string>;

const BANNER_ICON = {
  info: 'info',
  warning: 'info',
  success: 'check',
  danger: 'close',
  neutral: 'minus',
} as const satisfies Record<BannerTone, IconName>;

/**
 * 詳情最上方的一句話（docs/architecture/backend/20-approval.md §11.3）：現在在哪裡、在等誰、下一步是什麼，
 * 以及這個人能做什麼。核准的結果句由 `useApprovalOutcome` 依類型產生。
 */
export function ApprovalStatusBanner({
  approval,
  isRequester,
  onOpenApproval,
}: ApprovalStatusBannerProps) {
  const { t } = useTranslation();
  const access = useApprovalReviewAccess(approval);
  const outcome = useApprovalOutcome(approval);
  const step = approval.currentStep;
  const position = step ? approval.steps.indexOf(step) + 1 : 0;

  let tone: BannerTone;
  let headline: string;
  const details: string[] = [];
  if (approval.status === 'pending' && step?.shortage) {
    tone = 'danger';
    headline = t('approval.banner.shortage', { position, name: step.name });
    details.push(
      t(
        access.canOverride ? 'approval.banner.shortageCanOverride' : 'approval.banner.shortageHint',
      ),
    );
  } else if (approval.status === 'pending' && step) {
    tone = 'info';
    headline = t('approval.banner.step', {
      position,
      name: step.name,
      approvals: step.approvals,
      required: step.required ?? 0,
    });
    if (access.canDecide) details.push(t('approval.banner.yourTurn'));
  } else if (approval.status === 'pending') {
    tone = 'info';
    headline = t('approval.banner.single');
    if (access.visible) details.push(t('approval.banner.canReviewSingle'));
  } else if (approval.status === 'approved') {
    tone = 'success';
    headline = t('approval.banner.approved');
  } else if (approval.status === 'rejected') {
    tone = 'danger';
    headline = approval.reviewerName
      ? t('approval.banner.rejectedBy', { name: approval.reviewerName })
      : t('approval.banner.rejected');
  } else {
    tone = 'neutral';
    headline = t('approval.banner.withdrawn');
  }
  if (approval.status === 'pending' || approval.status === 'approved') details.push(outcome);
  if (access.canWithdraw) details.push(t('approval.banner.canWithdraw'));
  const canResubmit =
    isRequester &&
    !approval.resubmittedTo &&
    (approval.status === 'rejected' || approval.status === 'withdrawn');

  return (
    <section
      className={cn(
        'flex gap-3 rounded-[var(--radius-lg)] border border-s-4 bg-[var(--color-surface)] p-4',
        BANNER_CLASS[tone],
      )}
      data-testid="approval-status-banner"
      data-value={tone}
    >
      <Icon name={BANNER_ICON[tone]} size={20} className="shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 font-medium" data-testid="approval-status-headline">
          {headline}
        </p>
        {details.map((detail) => (
          <p key={detail} className="m-0 text-sm text-[var(--color-fg-muted)]">
            {detail}
          </p>
        ))}
        <div className="flex flex-wrap items-center gap-2 empty:hidden">
          {/* 匿名的註冊申請沒有申請人可以重新送出；其他類型照各自的入口 */}
          {canResubmit && approval.folderAccess && (
            <ApprovalResubmitLink approvalId={approval.id} folderAccess={approval.folderAccess} />
          )}
          {approval.resubmittedTo && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => approval.resubmittedTo && onOpenApproval(approval.resubmittedTo)}
              data-testid="approval-resubmitted-to"
            >
              {t('approval.banner.viewResubmission')}
            </Button>
          )}
          {approval.resubmittedFrom && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => approval.resubmittedFrom && onOpenApproval(approval.resubmittedFrom)}
              data-testid="approval-resubmitted-from"
            >
              {t('approval.banner.viewPrevious')}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
