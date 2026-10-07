import { Chip } from '@b2b-system/ui/Chip';

import { useTranslation } from '../locales';
import type { JobQueueVM } from './types';

export interface JobQueueSummaryProps {
  queues: JobQueueVM[];
}

/** 每種工作一張卡片：（範圍、）排程與各狀態的即時筆數。只顯示資訊；列表的篩選走篩選面板的多選。 */
export function JobQueueSummary({ queues }: JobQueueSummaryProps) {
  const { t } = useTranslation();
  return (
    <ul
      className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
      aria-label={t('job.queues.title')}
      data-testid="job-queue-summary"
    >
      {queues.map((queue) => (
        <li
          key={queue.name}
          className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-fg)]"
          data-testid="job-queue-card"
          data-value={queue.name}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="font-semibold">{queue.labelKey ? t(queue.labelKey) : queue.name}</span>
            {queue.failedCount > 0 && (
              <Chip tone="danger" data-testid="job-queue-failed" data-value={queue.failedCount}>
                {t('job.queues.failed', { count: queue.failedCount })}
              </Chip>
            )}
          </span>
          <code className="font-mono text-xs text-[var(--color-fg-muted)]">{queue.name}</code>
          <span className="text-xs text-[var(--color-fg-muted)]">
            {queue.scopeLabelKey && (
              <>
                {t(queue.scopeLabelKey)}
                {' · '}
              </>
            )}
            {queue.cron ? t('job.queues.cron', { cron: queue.cron }) : t('job.queues.onDemand')}
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <span>{t('job.queues.ready', { count: queue.readyCount })}</span>
            <span>{t('job.queues.deferred', { count: queue.deferredCount })}</span>
            <span>{t('job.queues.active', { count: queue.activeCount })}</span>
            <span>{t('job.queues.completed', { count: queue.completedCount })}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
