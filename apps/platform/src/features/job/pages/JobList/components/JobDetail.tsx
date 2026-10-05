import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getPlatformJobQueryOptions } from '@/apis/platform-job/get-job/query';

import { isFinalJobState, toJobDetailVM } from '../adapter';

interface JobDetailProps {
  id: string;
}

/** 還沒結束的工作（等待、重試、執行中）結果會變：展開時與列表同頻率重取，結束後就不再重取。 */
const PENDING_REFRESH_INTERVAL_MS = 10_000;

/** JSON 區塊：apps/platform 沒有 JsonViewer，以縮排文字呈現，超過高度在框內捲動。 */
function JsonBlock({ value, testId }: { value: unknown; testId: string }) {
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
 * 展開列的明細：工作資料與結果（失敗時是錯誤與 stack）。列表不帶這兩欄，展開時才向
 * `GET /platform/jobs/:id` 取。
 */
export function JobDetail({ id }: JobDetailProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const { data, error, isPending } = useQuery({
    ...getPlatformJobQueryOptions(id),
    select: toJobDetailVM,
    refetchInterval: (query) =>
      query.state.data && !isFinalJobState(query.state.data.state)
        ? PENDING_REFRESH_INTERVAL_MS
        : false,
  });

  return (
    <section data-testid="job-detail" aria-busy={isPending}>
      <h2 className="m-0 mb-2 text-sm font-semibold">{t('job.detail.title')}</h2>
      {error ? (
        <p className="m-0 text-sm text-[var(--color-danger-text)]" role="alert">
          {toMessage(error)}
        </p>
      ) : isPending || !data ? (
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('common.loading')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.errorMessage && (
            <p
              className="m-0 text-sm text-[var(--color-danger-text)]"
              data-testid="job-detail-error"
            >
              {t('job.detail.error', { message: data.errorMessage })}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="min-w-0">
              <p className="m-0 mb-1 text-xs text-[var(--color-fg-muted)]">
                {t('job.detail.data')}
              </p>
              <JsonBlock value={data.data} testId="job-detail-data" />
            </div>
            <div className="min-w-0">
              <p className="m-0 mb-1 text-xs text-[var(--color-fg-muted)]">
                {t('job.detail.output')}
              </p>
              {data.output ? (
                <JsonBlock value={data.output} testId="job-detail-output" />
              ) : (
                <p className="m-0 text-sm text-[var(--color-fg-muted)]">
                  {t('job.detail.noOutput')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
