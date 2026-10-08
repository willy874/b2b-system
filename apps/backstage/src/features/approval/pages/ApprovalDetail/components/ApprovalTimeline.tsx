import { Chip } from '@b2b-system/ui/Chip';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';

import {
  APPROVAL_ASSIGNEE_KIND_LABEL_KEY,
  APPROVAL_CLOSE_REASON_LABEL_KEY,
  APPROVAL_DECISION_LABEL_KEY,
  APPROVAL_DECISION_VIA_LABEL_KEY,
  APPROVAL_SHORTAGE_LABEL_KEY,
  APPROVAL_STEP_STATUS_LABEL_KEY,
  APPROVAL_STEP_STATUS_TONE,
} from '../../../constants';
import type { ApprovalStepVM } from '../adapter';

interface ApprovalTimelineProps {
  steps: ApprovalStepVM[];
}

/**
 * 多階段的關卡時間軸（docs/architecture/backend/20-approval.md §9.16）：每一關的規則、狀態、同意數、審核者與每個人的意見。
 * 停用多階段期間照樣唯讀顯示（那是誰同意過的紀錄，§9.11）。
 */
export function ApprovalTimeline({ steps }: ApprovalTimelineProps) {
  const { t } = useTranslation();
  if (!steps.length) return null;
  return (
    <section className="flex flex-col gap-3" data-testid="approval-timeline">
      <h3 className="m-0 text-sm font-semibold">{t('approval.step.title')}</h3>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map((step) => (
          <li
            key={step.ordinal}
            className="rounded-md border border-[var(--color-border)] p-3"
            data-testid="approval-step"
            data-value={step.ordinal}
            data-status={step.status}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{step.name}</span>
              <Chip
                tone={APPROVAL_STEP_STATUS_TONE[step.status]}
                data-testid="approval-step-status"
              >
                {t(APPROVAL_STEP_STATUS_LABEL_KEY[step.status])}
              </Chip>
              {step.required !== null && step.status !== 'skipped' && (
                <span
                  className="text-xs text-[var(--color-fg-muted)]"
                  data-testid="approval-step-count"
                >
                  {t('approval.step.count', { approvals: step.approvals, required: step.required })}
                </span>
              )}
              {step.shortage && step.status === 'active' && (
                <Chip tone="danger" data-testid="approval-step-shortage" data-value={step.shortage}>
                  {t(APPROVAL_SHORTAGE_LABEL_KEY[step.shortage])}
                </Chip>
              )}
            </div>
            <p className="m-0 mt-1 text-xs text-[var(--color-fg-muted)]">
              {step.assignee.label
                ? t('approval.step.assigneeWithLabel', {
                    kind: t(APPROVAL_ASSIGNEE_KIND_LABEL_KEY[step.assignee.kind]),
                    label: step.assignee.label,
                  })
                : t(APPROVAL_ASSIGNEE_KIND_LABEL_KEY[step.assignee.kind], {
                    level: step.assignee.kind === 'manager' ? step.assignee.level : undefined,
                  })}
              {step.closeReason && ` · ${t(APPROVAL_CLOSE_REASON_LABEL_KEY[step.closeReason])}`}
            </p>
            {step.status === 'skipped' && (
              <p className="m-0 mt-1 text-xs text-[var(--color-fg-muted)]">
                {t('approval.step.skippedHint')}
              </p>
            )}
            {step.candidates.length > 0 && (
              <p className="m-0 mt-1 text-xs" data-testid="approval-step-candidates">
                {t('approval.step.candidates', {
                  names: step.candidates
                    .map((candidate) => candidate.name)
                    .join(t('approval.step.nameSeparator')),
                })}
              </p>
            )}
            {step.decisions.length > 0 && (
              <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-sm">
                {step.decisions.map((decision) => (
                  <li key={`${decision.reviewerName}-${decision.decidedAt.toISOString()}`}>
                    <span className="font-medium">{decision.reviewerName}</span>{' '}
                    {t(APPROVAL_DECISION_LABEL_KEY[decision.decision])}
                    {decision.via !== 'assignee' &&
                      t('approval.step.viaSuffix', {
                        via: t(APPROVAL_DECISION_VIA_LABEL_KEY[decision.via]),
                      })}
                    <span className="text-xs text-[var(--color-fg-muted)]">
                      {' · '}
                      {formatDateTime(decision.decidedAt)}
                    </span>
                    {decision.comment && (
                      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{decision.comment}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
