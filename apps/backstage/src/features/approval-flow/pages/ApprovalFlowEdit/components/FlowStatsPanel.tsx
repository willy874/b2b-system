import { Chip } from '@b2b-system/ui/Chip';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getApprovalFlowStatsQueryOptions } from '@/apis/approval-flow/get-approval-flow-stats/query';

import { formatDuration } from '../../../hooks/formatDuration';

interface FlowStatsPanelProps {
  type: string;
}

/**
 * 流程的實際運作（docs/architecture/backend/20-approval.md §9.16、§12 D9）：近 30 天送出與定案的筆數、平均要多久，
 * 以及目前進行中的申請停在哪一關、有沒有找不到審核者的。
 */
export function FlowStatsPanel({ type }: FlowStatsPanelProps) {
  const { t } = useTranslation();
  const { data, isPending } = useQuery(getApprovalFlowStatsQueryOptions(type));

  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-4"
      data-testid="approval-flow-stats"
    >
      <h2 className="m-0 text-base font-semibold">
        {t('approvalFlow.stats.title', { days: data?.days ?? 30 })}
      </h2>
      {isPending && <Skeleton height={80} />}
      {data && data.submitted === 0 && data.pending === 0 && (
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('approvalFlow.stats.empty')}</p>
      )}
      {data && (data.submitted > 0 || data.pending > 0) && (
        <>
          <dl className="m-0 grid grid-cols-2 gap-2 text-sm">
            <Stat label={t('approvalFlow.stats.submitted')} value={data.submitted} />
            <Stat label={t('approvalFlow.stats.approved')} value={data.approved} />
            <Stat label={t('approvalFlow.stats.rejected')} value={data.rejected} />
            <Stat label={t('approvalFlow.stats.withdrawn')} value={data.withdrawn} />
            <Stat
              label={t('approvalFlow.stats.average')}
              value={data.averageHours === null ? '-' : formatDuration(data.averageHours, t)}
            />
            <Stat
              label={t('approvalFlow.stats.pending')}
              value={data.pending}
              testId="approval-flow-stats-pending"
            />
          </dl>
          {data.currentSteps.length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('approvalFlow.stats.currentSteps')}</span>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {data.currentSteps.map((step) => (
                  <li
                    key={step.name}
                    className="flex flex-wrap items-center gap-2"
                    data-testid="approval-flow-stats-step"
                    data-value={step.name}
                  >
                    <span>
                      {t('approvalFlow.stats.stepPending', {
                        name: step.name,
                        count: step.pending,
                      })}
                    </span>
                    {step.shortage > 0 && (
                      <Chip tone="danger">
                        {t('approvalFlow.stats.shortage', { count: step.shortage })}
                      </Chip>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: number | string;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-col rounded-md bg-[var(--color-fill-subtle)] px-3 py-2"
      data-testid={testId}
    >
      <dt className="text-xs text-[var(--color-fg-muted)]">{label}</dt>
      <dd className="m-0 text-base font-semibold">{value}</dd>
    </div>
  );
}
