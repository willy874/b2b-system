import { JobQueueSummary, JobTable } from '@b2b-system/web-core/job';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { getPlatformJobListQueryOptions } from '@/apis/platform-job/get-job-list/query';
import { getPlatformJobQueuesQueryOptions } from '@/apis/platform-job/get-job-queues/query';

import { useJobPermission } from '../../hooks/useJobPermission';
import { useRetryJobMutation } from '../../hooks/useRetryJobMutation';
import { toJobQueueVM, toJobRowVM } from './adapter';
import type { PlatformJobRowVM } from './adapter';
import { JobDetail } from './components/JobDetail';
import { useJobFilters } from './useJobFilters';
import { useJobSearchFilter } from './useJobSearchFilter';
import { useJobTenantColumn } from './useJobTenantColumn';

/** 工作在背景持續變化：每 10 秒重新整理一次，不必手動重新載入。 */
const REFRESH_INTERVAL_MS = 10_000;

/** 展開列的內容：明細在展開當下才向後端取（`JobDetail`）。 */
const renderDetail = (row: PlatformJobRowVM) => <JobDetail id={row.id} />;

/**
 * 平台管理者的背景工作監控：所有租戶與平台層級的工作。
 * 上方是每種工作的佇列筆數（所有租戶加總），下方是可依工作、狀態、租戶篩選的列表。
 */
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
  const { mutateAsync: retryJob } = useRetryJobMutation();
  const onRetryJob = useCallback((id: string) => retryJob({ params: { id } }), [retryJob]);
  const tenantColumn = useJobTenantColumn();

  const { data: queueData } = useQuery({
    ...getPlatformJobQueuesQueryOptions(),
    refetchInterval: REFRESH_INTERVAL_MS,
  });
  const { data, error, isPending, refetch } = useQuery({
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
  const filters = useJobFilters(searchFilter, queues);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="job-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('job.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('job.description')}</p>
      </header>

      <JobQueueSummary
        queues={queues}
        selectedName={search.name}
        onSelect={(name) => setFilter({ name })}
      />

      <JobTable
        items={rows}
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        expandedId={expanded}
        onToggleExpand={toggleExpand}
        renderDetail={renderDetail}
        onRetryJob={onRetryJob}
        extraColumns={tenantColumn}
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
