import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { getJobListQueryOptions } from '@/apis/job/get-job-list/query';
import { getJobQueueListQueryOptions } from '@/apis/job/get-job-queue-list/query';

import { useJobPermission } from '../../hooks/useJobPermission';
import { toJobQueueVM, toJobRowVM } from './adapter';
import { JobQueueSummary } from './components/JobQueueSummary';
import { JobTable } from './components/JobTable';
import { useJobFilters } from './useJobFilters';
import { useJobSearchFilter } from './useJobSearchFilter';

/** 工作在背景持續變化：每 10 秒重新整理一次，不必手動重新載入。 */
const REFRESH_INTERVAL_MS = 10_000;

export default function JobListPage() {
  const { t } = useTranslation();
  const { canRetry } = useJobPermission();
  const searchFilter = useJobSearchFilter();
  const { search, setFilter, setPage } = searchFilter;
  const [expanded, setExpanded] = useState<string>();
  const toggleExpand = useCallback(
    (id: string) => setExpanded((prev) => (prev === id ? undefined : id)),
    [],
  );

  const queueQuery = useQuery({
    ...getJobQueueListQueryOptions(),
    refetchInterval: REFRESH_INTERVAL_MS,
  });
  const queueData = queueQuery.data;
  const { data, isPending, error, refetch } = useQuery({
    ...getJobListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        name: search.name,
        state: search.state,
      },
    }),
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const queues = useMemo(() => (queueData?.items ?? []).map(toJobQueueVM), [queueData]);
  const rows = useMemo(
    () => (data?.items ?? []).map((item) => toJobRowVM(item, { canRetry })),
    [canRetry, data],
  );
  const filters = useJobFilters(searchFilter, queues);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="job-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('job.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('job.description')}</p>
      </header>

      {/* 佇列摘要失敗而且沒有舊資料：說明並提供重試，不是讓卡片默默消失 */}
      {queueQuery.isError && !queueData ? (
        <QueryError
          error={queueQuery.error}
          onRetry={() => void queueQuery.refetch()}
          data-testid="job-queue-error"
        />
      ) : (
        <JobQueueSummary
          queues={queues}
          selectedName={search.name}
          onSelect={(name) => setFilter({ name, state: search.state })}
        />
      )}

      <JobTable
        items={rows}
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        expandedId={expanded}
        onToggleExpand={toggleExpand}
        filters={filters}
        pagination={{
          offset: search.offset,
          limit: search.limit,
          total: data?.pagination.total ?? 0,
          pageSizeOptions: [25, 50, 100],
          onChange: ({ offset, limit }) => setPage(offset, limit),
        }}
      />
    </div>
  );
}
