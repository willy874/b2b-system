import { Chip } from '@b2b-system/ui/Chip';
import { useTranslation } from '@b2b-system/web-core/locales';

import { APPROVAL_SHORTAGE_LABEL_KEY } from '../../../constants';

interface ApprovalProgressProps {
  row: {
    progress: {
      name: string;
      approvals: number;
      required: number;
      shortage: 'noCandidate' | 'insufficient' | null;
    } | null;
    stepCount: number;
  };
}

/**
 * 多階段的進度：目前的關卡與同意數（`財務 1／2`），找不到審核者時標示（docs/architecture/backend/20-approval.md §9.16）。
 * 單關請求與已結束的請求顯示「-」。
 */
export function ApprovalProgress({ row }: ApprovalProgressProps) {
  const { t } = useTranslation();
  if (!row.progress) return <span className="text-[var(--color-fg-muted)]">-</span>;
  const { name, approvals, required, shortage } = row.progress;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-2 whitespace-nowrap"
      data-testid="approval-progress"
      data-value={name}
    >
      {t('approval.progress.step', { name, approvals, required })}
      {shortage && (
        <Chip tone="danger" data-testid="approval-progress-shortage" data-value={shortage}>
          {t(APPROVAL_SHORTAGE_LABEL_KEY[shortage])}
        </Chip>
      )}
    </span>
  );
}
