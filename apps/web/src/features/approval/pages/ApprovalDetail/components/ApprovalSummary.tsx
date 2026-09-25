import type { ReactNode } from 'react';

import { Chip } from '@/components/Chip';
import { useTranslation } from '@/core/locales';
import { formatDateTime } from '@/shared/date';

import { APPROVAL_STATUS_LABEL_KEY, APPROVAL_STATUS_TONE } from '../../../constants';
import type { ApprovalDetailVM } from '../adapter';

interface ApprovalSummaryProps {
  approval: ApprovalDetailVM;
}

/** 申請內容與審核結果（唯讀）。 */
export function ApprovalSummary({ approval }: ApprovalSummaryProps) {
  const { t } = useTranslation();
  return (
    <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
      <Row label={t('approval.field.status')}>
        <Chip
          tone={APPROVAL_STATUS_TONE[approval.status]}
          data-testid="approval-detail-status"
          data-value={approval.status}
        >
          {t(APPROVAL_STATUS_LABEL_KEY[approval.status])}
        </Chip>
      </Row>
      {approval.registration && (
        <>
          <Row label={t('approval.field.email')}>{approval.registration.email}</Row>
          <Row label={t('approval.field.displayName')}>{approval.registration.displayName}</Row>
        </>
      )}
      <Row label={t('approval.field.reason')}>
        {approval.reason ?? (
          <span className="text-[var(--color-fg-muted)]">{t('common.none')}</span>
        )}
      </Row>
      <Row label={t('approval.field.createdAt')}>{formatDateTime(approval.createdAt)}</Row>
      {!approval.isPending && (
        <>
          <Row label={t('approval.field.reviewer')}>{approval.reviewerName ?? '-'}</Row>
          <Row label={t('approval.field.reviewedAt')}>{formatDateTime(approval.reviewedAt)}</Row>
          <Row label={t('approval.field.comment')}>
            {approval.reviewComment ?? (
              <span className="text-[var(--color-fg-muted)]">{t('common.none')}</span>
            )}
          </Row>
        </>
      )}
    </dl>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[var(--color-fg-muted)]">{label}</dt>
      <dd className="m-0 break-all">{children}</dd>
    </>
  );
}
