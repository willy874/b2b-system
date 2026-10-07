import { isFinalJobState, JobDetailView } from '@b2b-system/web-core/job';
import type { JobDetailJsonOptions } from '@b2b-system/web-core/job';
import { useQuery } from '@tanstack/react-query';

import { getPlatformJobQueryOptions } from '@/apis/platform-job/get-job/query';

import { toJobDetailVM } from '../adapter';

/** 還沒結束的工作（等待、重試、執行中）結果會變：展開時與列表同頻率重取，結束後就不再重取。 */
const PENDING_REFRESH_INTERVAL_MS = 10_000;

/** JSON 區塊：縮排文字，超過高度在框內捲動。 */
function renderJson(value: Record<string, unknown>, { testId }: JobDetailJsonOptions) {
  return (
    <pre
      className="m-0 max-h-64 overflow-auto rounded-md bg-[var(--color-fill-subtle)] p-2 font-mono text-xs"
      data-testid={testId}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * 展開列的明細：列表不帶工作資料與結果，展開時才向 `GET /platform/jobs/:id` 取。
 * 畫面是 web-core 的 `JobDetailView`。
 */
export function JobDetail({ id }: { id: string }) {
  const { data, error, isPending } = useQuery({
    ...getPlatformJobQueryOptions(id),
    select: toJobDetailVM,
    refetchInterval: (query) =>
      query.state.data && !isFinalJobState(query.state.data.state)
        ? PENDING_REFRESH_INTERVAL_MS
        : false,
  });
  return <JobDetailView data={data} error={error} isPending={isPending} renderJson={renderJson} />;
}
