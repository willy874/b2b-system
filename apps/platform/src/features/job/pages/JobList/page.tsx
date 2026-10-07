import {
  JOB_PAGE_SIZE_OPTIONS,
  JOB_REFRESH_INTERVAL_MS,
  JobPageHeader,
  JobPageTabs,
  JobTable,
  useExpandedJob,
} from '@b2b-system/web-core/job';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

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

/** 展開列的內容：明細在展開當下才向後端取（`JobDetail`）。 */
const renderDetail = (row: PlatformJobRowVM) => <JobDetail id={row.id} />;

/**
 * 平台管理者的背景工作監控：所有租戶與平台層級的工作。
 * 「佇列概況」分頁是每種工作的佇列筆數（所有租戶加總），列表可依工作、狀態（多選）、租戶篩選。
 */
export default function JobListPage() {
  const { t } = useTranslation();
  const { canRetry } = useJobPermission();
  const searchFilter = useJobSearchFilter();
  const { search, setPage, setView } = searchFilter;
  const expansion = useExpandedJob();
  const { mutateAsync: retryJob } = useRetryJobMutation();
  const onRetryJob = useCallback((id: string) => retryJob({ params: { id } }), [retryJob]);
  const tenantColumn = useJobTenantColumn();

  const queueQuery = useQuery({
    ...getPlatformJobQueuesQueryOptions(),
    refetchInterval: JOB_REFRESH_INTERVAL_MS,
  });
  const queueData = queueQuery.data;
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
      <JobPageHeader title={t('job.title')} description={t('job.description')} />

      {/* 佇列摘要查詢失敗而且沒有舊資料時，「佇列概況」分頁裡說明並提供重試 */}
      <JobPageTabs
        view={search.view}
        onViewChange={setView}
        queues={queues}
        queueError={queueData ? undefined : queueQuery.error}
        onRetryQueues={() => void queueQuery.refetch()}
      >
        <JobTable
          items={rows}
          loading={isPending}
          error={error}
          onRetry={() => void refetch()}
          {...expansion}
          renderDetail={renderDetail}
          onRetryJob={onRetryJob}
          extraColumns={tenantColumn}
          filters={filters}
          pagination={{
            offset: search.offset,
            limit: search.limit,
            total: data?.pagination.total ?? 0,
            pageSizeOptions: JOB_PAGE_SIZE_OPTIONS,
            onChange: ({ offset, limit }) => setPage(offset, limit),
          }}
        />
      </JobPageTabs>
    </div>
  );
}
