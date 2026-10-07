import { Chip } from '@b2b-system/ui/Chip';
import { Tabs, TabsPanel } from '@b2b-system/ui/Tabs';
import type { ReactNode } from 'react';

import { QueryError } from '../components';
import { useTranslation } from '../locales';
import { JOB_VIEWS } from './constants';
import type { JobView } from './constants';
import { JobQueueSummary } from './JobQueueSummary';
import type { JobQueueVM } from './types';

export interface JobPageTabsProps {
  /** 目前的分頁；app 放在網址的 `view`。 */
  view: JobView;
  onViewChange: (view: JobView) => void;
  queues: JobQueueVM[];
  /** 佇列摘要查詢失敗而且沒有舊資料時的錯誤：「佇列概況」分頁裡說明並提供重試。 */
  queueError?: unknown;
  onRetryQueues?: () => void;
  /** 「工作列表」分頁的內容（app 的 `JobTable`）。 */
  children: ReactNode;
}

const VIEW_LABEL_KEY = {
  list: 'job.tabs.list',
  queues: 'job.tabs.queues',
} as const satisfies Record<JobView, string>;

function isJobView(value: string): value is JobView {
  return (JOB_VIEWS as readonly string[]).includes(value);
}

/**
 * 背景工作頁的兩個分頁（兩個 app 共用）：工作列表、佇列概況（每種工作一張卡片）。
 * 佇列的失敗總數掛在「佇列概況」分頁上；依工作種類篩選列表走列表的篩選面板。
 */
export function JobPageTabs({
  view,
  onViewChange,
  queues,
  queueError,
  onRetryQueues,
  children,
}: JobPageTabsProps) {
  const { t } = useTranslation();
  const failed = queues.reduce((sum, queue) => sum + queue.failedCount, 0);

  return (
    <Tabs
      moreLabel={t('common.more')}
      value={view}
      onValueChange={(value) => {
        if (isJobView(value)) onViewChange(value);
      }}
      tabs={JOB_VIEWS.map((value) => ({
        value,
        textValue: t(VIEW_LABEL_KEY[value]),
        label: (
          <span className="inline-flex items-center gap-2">
            {t(VIEW_LABEL_KEY[value])}
            {value === 'queues' && failed > 0 && (
              <Chip tone="danger" data-testid="job-queue-tab-failed" data-value={failed}>
                {t('job.queues.failed', { count: failed })}
              </Chip>
            )}
          </span>
        ),
      }))}
      className="min-h-0 flex-1"
      testIds={{ tab: 'job-view-tab' }}
      data-testid="job-view"
    >
      <TabsPanel value="list" className="flex min-h-0 flex-1 flex-col">
        {children}
      </TabsPanel>
      {/* 與列表一樣填滿分頁下方的空間；卡片多時在面板裡捲動，標題與分頁列留在原位 */}
      <TabsPanel
        value="queues"
        className="flex min-h-0 flex-1 flex-col gap-3"
        data-testid="job-queue-panel"
      >
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('job.queues.hint')}</p>
        <div className="min-h-0 flex-1 overflow-auto">
          {queueError && queues.length === 0 ? (
            <QueryError error={queueError} onRetry={onRetryQueues} data-testid="job-queue-error" />
          ) : (
            <JobQueueSummary queues={queues} />
          )}
        </div>
      </TabsPanel>
    </Tabs>
  );
}
