import { JsonViewer } from '@b2b-system/ui/JsonViewer';
import type { JsonViewerLabels } from '@b2b-system/ui/JsonViewer';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getJobDetailQueryOptions } from '@/apis/job/get-job-detail/query';

import { isFinalJobState, toJobDetailVM } from '../adapter';

interface JobDetailProps {
  id: string;
}

/** 單一區塊的最大高度；超過在框內捲動，展開列不會把整頁撐長。 */
const JSON_MAX_HEIGHT = '16rem';

/** 還沒結束的工作（等待、重試、執行中）結果會變：展開時與列表同頻率重取，結束後就不再重取。 */
const PENDING_REFRESH_INTERVAL_MS = 10_000;

/**
 * 展開列的明細：工作資料與結果（失敗時是錯誤與 stack）。列表不帶這兩欄，展開時才向 `GET /jobs/:id` 取。
 */
export function JobDetail({ id }: JobDetailProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
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
              <JsonViewer
                value={data.data}
                maxHeight={JSON_MAX_HEIGHT}
                labels={jsonLabels}
                aria-label={t('job.detail.data')}
                data-testid="job-detail-data"
              />
            </div>
            <div className="min-w-0">
              <p className="m-0 mb-1 text-xs text-[var(--color-fg-muted)]">
                {t('job.detail.output')}
              </p>
              {data.output ? (
                <JsonViewer
                  value={data.output}
                  maxHeight={JSON_MAX_HEIGHT}
                  labels={jsonLabels}
                  aria-label={t('job.detail.output')}
                  data-testid="job-detail-output"
                />
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
