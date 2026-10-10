import { Chip } from '@b2b-system/ui/Chip';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatRelativeTime } from '@b2b-system/web-shared/date';

import type { ApprovalRequest } from '@/shared/api-sdk';

import { APPROVAL_SHORTAGE_LABEL_KEY } from '../constants';

interface ApprovalProgressProps {
  row: {
    progress: ApprovalRequest['currentStep'];
    stepCount: number;
  };
}

/**
 * 多階段的進度（docs/architecture/backend/20-approval.md §11.2）：目前的關卡與同意數（`財務 1／2`），
 * 下一行是還沒做決定的人與等了多久（「等待 王小明、李小華 等 3 人・2 天前開始」）；找不到審核者時標示。
 * 單關請求與已結束的請求顯示「-」。
 */
export function ApprovalProgress({ row }: ApprovalProgressProps) {
  const { t } = useTranslation();
  if (!row.progress) return <span className="text-[var(--color-fg-muted)]">-</span>;
  const { name, approvals, required, shortage, pendingReviewers, pendingCount, activatedAt } =
    row.progress;
  const names = pendingReviewers.join(t('approval.step.nameSeparator'));
  return (
    <span
      className="inline-flex flex-col gap-0.5"
      data-testid="approval-progress"
      data-value={name}
    >
      <span className="inline-flex flex-wrap items-center gap-2 whitespace-nowrap">
        {t('approval.progress.step', { name, approvals, required })}
        {shortage && (
          <Chip tone="danger" data-testid="approval-progress-shortage" data-value={shortage}>
            {t(APPROVAL_SHORTAGE_LABEL_KEY[shortage])}
          </Chip>
        )}
      </span>
      {pendingCount > 0 && (
        <span
          className="text-xs text-[var(--color-fg-muted)]"
          data-testid="approval-progress-waiting"
          data-value={pendingCount}
        >
          {pendingCount > pendingReviewers.length
            ? t('approval.progress.waitingMore', { names, count: pendingCount })
            : t('approval.progress.waiting', { names })}
          {activatedAt && ` · ${formatRelativeTime(activatedAt)}`}
        </span>
      )}
    </span>
  );
}
