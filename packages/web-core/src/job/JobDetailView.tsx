import type { ReactNode } from 'react';

import { useErrorMessage } from '../errors';
import { useTranslation } from '../locales';
import type { JobDetailVM } from './types';

export interface JobDetailJsonOptions {
  /** 完整字面量：`job-detail-data`、`job-detail-output` */
  testId: string;
  /** 區塊的名稱（「工作資料」、「執行結果」），給報讀器 */
  label: string;
}

export interface JobDetailViewProps {
  data: JobDetailVM | undefined;
  error: unknown;
  isPending: boolean;
  /**
   * 工作資料與結果的 JSON 怎麼呈現（backstage 用可收合的 `JsonViewer`，apps/platform 用縮排文字）。
   * 呈現方式兩個 app 原本就不同，以參數保留。
   */
  renderJson: (value: Record<string, unknown>, options: JobDetailJsonOptions) => ReactNode;
}

/** 展開列的明細：工作資料與結果（失敗時是錯誤與 stack）。資料由 app 的 `JobDetail` 向自己的端點取。 */
export function JobDetailView({ data, error, isPending, renderJson }: JobDetailViewProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();

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
              {renderJson(data.data, { testId: 'job-detail-data', label: t('job.detail.data') })}
            </div>
            <div className="min-w-0">
              <p className="m-0 mb-1 text-xs text-[var(--color-fg-muted)]">
                {t('job.detail.output')}
              </p>
              {data.output ? (
                renderJson(data.output, {
                  testId: 'job-detail-output',
                  label: t('job.detail.output'),
                })
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
