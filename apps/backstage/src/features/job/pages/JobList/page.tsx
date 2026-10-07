import {
  JOB_PAGE_SIZE_OPTIONS,
  JOB_REFRESH_INTERVAL_MS,
  JobPageHeader,
  JobTable,
  useExpandedJob,
} from '@b2b-system/web-core/job';
import type { JobRowVM } from '@b2b-system/web-core/job';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { getJobListQueryOptions } from '@/apis/job/get-job-list/query';
import { getJobQueueListQueryOptions } from '@/apis/job/get-job-queue-list/query';

import { useJobPermission } from '../../hooks/useJobPermission';
import { useRetryJobMutation } from '../../hooks/useRetryJobMutation';
import { toJobQueueVM, toJobRowVM } from './adapter';
import { JobDetail } from './components/JobDetail';
import { useJobFilters } from './useJobFilters';
import { useJobSearchFilter } from './useJobSearchFilter';

/** 展開列的內容：明細在展開當下才向後端取（`JobDetail`）。 */
const renderDetail = (row: JobRowVM) => <JobDetail id={row.id} />;

export default function JobListPage() {
  const { t } = useTranslation();
  const { canRetry } = useJobPermission();
  const searchFilter = useJobSearchFilter();
  const { search, setFilter, setPage } = searchFilter;
  const expansion = useExpandedJob();
  const { mutateAsync: retryJob } = useRetryJobMutation();
  const onRetryJob = useCallback((id: string) => retryJob({ params: { jobId: id } }), [retryJob]);

  const queueQuery = useQuery({
    ...getJobQueueListQueryOptions(),
    refetchInterval: JOB_REFRESH_INTERVAL_MS,
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
    refetchInterval: JOB_REFRESH_INTERVAL_MS,
  });

  const queues = useMemo(() => (queueData?.items ?? []).map(toJobQueueVM), [queueData]);
  const rows = useMemo(
    () => (data?.items ?? []).map((item) => toJobRowVM(item, { canRetry })),
    [canRetry, data],
  );
  const filters = useJobFilters(searchFilter, queues);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="job-page">
      {/* 佇列概況收在對話框；查詢失敗而且沒有舊資料時對話框裡說明並提供重試 */}
      <JobPageHeader
        title={t('job.title')}
        description={t('job.description')}
        queues={queues}
        error={queueData ? undefined : queueQuery.error}
        onRetry={() => void queueQuery.refetch()}
        selectedNames={search.name ?? []}
        onSelect={(names) => setFilter({ name: names.length ? names : undefined })}
      />

      <JobTable
        items={rows}
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        {...expansion}
        renderDetail={renderDetail}
        onRetryJob={onRetryJob}
        filters={filters}
        pagination={{
          offset: search.offset,
          limit: search.limit,
          total: data?.pagination.total ?? 0,
          pageSizeOptions: JOB_PAGE_SIZE_OPTIONS,
          onChange: ({ offset, limit }) => setPage(offset, limit),
        }}
      />
    </div>
  );
}
