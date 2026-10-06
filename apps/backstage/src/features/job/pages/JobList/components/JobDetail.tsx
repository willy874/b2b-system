import { JsonViewer } from '@b2b-system/ui/JsonViewer';
import type { JsonViewerLabels } from '@b2b-system/ui/JsonViewer';
import { isFinalJobState, JobDetailView } from '@b2b-system/web-core/job';
import type { JobDetailJsonOptions } from '@b2b-system/web-core/job';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getJobDetailQueryOptions } from '@/apis/job/get-job-detail/query';

import { toJobDetailVM } from '../adapter';

interface JobDetailProps {
  id: string;
}

/** 還沒結束的工作（等待、重試、執行中）結果會變：展開時與列表同頻率重取，結束後就不再重取。 */
const PENDING_REFRESH_INTERVAL_MS = 10_000;

/** 單一區塊的最大高度；超過在框內捲動，展開列不會把整頁撐長。 */
const JSON_MAX_HEIGHT = '16rem';

/**
 * 展開列的明細：列表不帶工作資料與結果，展開時才向 `GET /jobs/:id` 取。
 * 畫面是 web-core 的 `JobDetailView`；JSON 以可收合的 `JsonViewer` 呈現。
 */
export function JobDetail({ id }: JobDetailProps) {
  const { t } = useTranslation();
  const jsonLabels: JsonViewerLabels = {
    expand: t('job.expand'),
    collapse: t('job.collapse'),
    summary: (count, container) =>
      container === 'array'
        ? t('job.detail.arraySummary', { count })
        : t('job.detail.objectSummary', { count }),
  };
  const { data, error, isPending } = useQuery({
    ...getJobDetailQueryOptions(id),
    select: toJobDetailVM,
    refetchInterval: (query) =>
      query.state.data && !isFinalJobState(query.state.data.state)
        ? PENDING_REFRESH_INTERVAL_MS
        : false,
  });

  const renderJson = (value: Record<string, unknown>, { testId, label }: JobDetailJsonOptions) => (
    <JsonViewer
      value={value}
      maxHeight={JSON_MAX_HEIGHT}
      labels={jsonLabels}
      aria-label={label}
      data-testid={testId}
    />
  );

  return <JobDetailView data={data} error={error} isPending={isPending} renderJson={renderJson} />;
}
