import { Chip } from '@b2b-system/ui/Chip';
import { cn } from '@b2b-system/web-shared/utils';

import { useTranslation } from '../locales';
import type { JobQueueVM } from './types';

export interface JobQueueSummaryProps {
  queues: JobQueueVM[];
  /** 目前篩選的工作種類（可以多選）。 */
  selectedNames: readonly string[];
  /** 點卡片加入或移出篩選；回傳新的清單。 */
  onSelect: (names: string[]) => void;
}

/** 每種工作一張卡片：（範圍、）排程與各狀態的即時筆數。點卡片加入或移出列表的篩選（可以多選）。 */
export function JobQueueSummary({ queues, selectedNames, onSelect }: JobQueueSummaryProps) {
  const { t } = useTranslation();
  return (
    <ul
      className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
      aria-label={t('job.queues.title')}
      data-testid="job-queue-summary"
    >
      {queues.map((queue) => {
        const isSelected = selectedNames.includes(queue.name);
        return (
          <li key={queue.name}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() =>
                onSelect(
                  isSelected
                    ? selectedNames.filter((name) => name !== queue.name)
                    : [...selectedNames, queue.name],
                )
              }
              className={cn(
                'flex w-full cursor-pointer flex-col gap-2 rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-4 text-left text-[var(--color-fg)] hover:bg-[var(--color-fill-subtle)]',
                isSelected ? 'border-[var(--color-brand)]' : 'border-[var(--color-border)]',
              )}
              data-testid="job-queue-card"
              data-value={queue.name}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  {queue.labelKey ? t(queue.labelKey) : queue.name}
                </span>
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
            </button>
          </li>
        );
      })}
    </ul>
  );
}
