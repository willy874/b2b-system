import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { getPlatformJobListQueryOptions } from '@/apis/platform-job/get-job-list/query';
import { getPlatformJobQueuesQueryOptions } from '@/apis/platform-job/get-job-queues/query';
import { Pagination } from '@/components/Pagination';
import { useTranslation } from '@/core/locales';

import { useJobPermission } from '../../hooks/useJobPermission';
import { toJobQueueVM, toJobRowVM } from './adapter';
import { JobFilters } from './components/JobFilters';
import { JobQueueSummary } from './components/JobQueueSummary';
import { JobTable } from './components/JobTable';
import { useJobSearchFilter } from './useJobSearchFilter';

/** 工作在背景持續變化：每 10 秒重新整理一次，不必手動重新載入。 */
const REFRESH_INTERVAL_MS = 10_000;

const PAGE_SIZE_OPTIONS = [25, 50, 100];

/**
 * 平台管理者的背景工作監控：所有租戶與平台層級的工作。
 * 上方是每種工作的佇列筆數（所有租戶加總），下方是可依工作、狀態、租戶篩選的列表。
 */
export default function JobListPage() {
  const { t } = useTranslation();
  const { canRetry } = useJobPermission();
  const { search, setFilter, setPage } = useJobSearchFilter();
  const [expanded, setExpanded] = useState<string>();
  const toggleExpand = useCallback(
    (id: string) => setExpanded((prev) => (prev === id ? undefined : id)),
    [],
  );

  const { data: queueData } = useQuery({
    ...getPlatformJobQueuesQueryOptions(),
    refetchInterval: REFRESH_INTERVAL_MS,
  });
  const { data, isPending } = useQuery({
    ...getPlatformJobListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        name: search.name,
        state: search.state,
        tenant: search.tenant,
      },
    }),
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const queues = useMemo(() => (queueData?.items ?? []).map(toJobQueueVM), [queueData]);
  const rows = useMemo(
    () => (data?.items ?? []).map((item) => toJobRowVM(item, { canRetry })),
    [canRetry, data],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="job-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('job.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('job.description')}</p>
      </header>

      <JobQueueSummary
        queues={queues}
        selectedName={search.name}
        onSelect={(name) => setFilter({ name })}
      />

      <JobFilters search={search} queues={queues} onChange={setFilter} />

      <JobTable
        items={rows}
        loading={isPending}
        expandedId={expanded}
        onToggleExpand={toggleExpand}
      />

      <Pagination
        offset={search.offset}
        limit={search.limit}
        total={data?.pagination.total ?? 0}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onChange={({ offset, limit }) => setPage(offset, limit)}
        labels={{
          previous: t('common.previous'),
          next: t('common.next'),
          summary: ({ from, to, total }) => t('job.pagination.summary', { from, to, total }),
        }}
      />
    </div>
  );
}
