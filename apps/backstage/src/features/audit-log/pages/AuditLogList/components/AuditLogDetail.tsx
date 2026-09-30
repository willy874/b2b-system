import { useQuery } from '@tanstack/react-query';

import { getAuditLogDetailQueryOptions } from '@/apis/audit-log/get-audit-log-detail/query';
import { JsonDiff } from '@/components/JsonDiff';
import type { JsonDiffLabels } from '@/components/JsonDiff';
import { JsonViewer } from '@/components/JsonViewer';
import type { JsonViewerLabels } from '@/components/JsonViewer';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { toAuditLogDetailVM } from '../adapter';

interface AuditLogDetailProps {
  id: string;
}

/** 單一區塊的最大高度；超過在框內捲動，展開列不會把整頁撐長。 */
const JSON_MAX_HEIGHT = '16rem';

/**
 * 展開列的明細：變更前後以 `JsonDiff` 逐行標出新增／刪除，metadata 以 `JsonViewer` 顯示
 * （長內容在框內捲動、大量資料虛擬捲動）。
 * 這兩欄是稽核紀錄裡最大的部分，列表不帶，展開時才向 `GET /audit-logs/:id` 取。
 */
export function AuditLogDetail({ id }: AuditLogDetailProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const jsonLabels: JsonViewerLabels = {
    expand: t('auditLog.expand'),
    collapse: t('auditLog.collapse'),
    summary: (count, container) =>
      container === 'array'
        ? t('auditLog.detail.arraySummary', { count })
        : t('auditLog.detail.objectSummary', { count }),
  };
  const diffLabels: JsonDiffLabels = {
    expandUnchanged: (count) => t('auditLog.detail.expandUnchanged', { count }),
    empty: t('auditLog.detail.noChanges'),
  };
  const { data, error, isPending } = useQuery({
    ...getAuditLogDetailQueryOptions(id),
    select: toAuditLogDetailVM,
    // 稽核紀錄不可變，取過一次就不需要再重取
    staleTime: Infinity,
  });

  return (
    <section data-testid="audit-log-detail" aria-busy={isPending}>
      <h2 className="m-0 mb-2 text-sm font-semibold">{t('auditLog.detail.title')}</h2>
      {error ? (
        <p className="m-0 text-sm text-[var(--color-danger-text)]" role="alert">
          {toMessage(error)}
        </p>
      ) : isPending || !data ? (
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('common.loading')}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <p className="m-0 mb-1 text-xs text-[var(--color-fg-muted)]">
              {t('auditLog.detail.changes')}
            </p>
            <JsonDiff
              before={data.changes.before}
              after={data.changes.after}
              maxHeight={JSON_MAX_HEIGHT}
              labels={diffLabels}
              aria-label={t('auditLog.detail.changes')}
              data-testid="audit-log-detail-changes"
            />
          </div>
          <div className="min-w-0">
            <p className="m-0 mb-1 text-xs text-[var(--color-fg-muted)]">
              {t('auditLog.detail.metadata')}
            </p>
            <JsonViewer
              value={data.metadata}
              maxHeight={JSON_MAX_HEIGHT}
              labels={jsonLabels}
              aria-label={t('auditLog.detail.metadata')}
              data-testid="audit-log-detail-metadata"
            />
          </div>
        </div>
      )}
    </section>
  );
}
