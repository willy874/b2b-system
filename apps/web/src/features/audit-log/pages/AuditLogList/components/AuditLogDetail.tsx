import { useQuery } from '@tanstack/react-query';

import { getAuditLogDetailQueryOptions } from '@/apis/audit-log/get-audit-log-detail/query';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { toAuditLogDetailVM } from '../adapter';

interface AuditLogDetailProps {
  id: string;
}

/**
 * 展開列的明細：變更前後與 metadata 原樣以 JSON 顯示。
 * 這兩欄是稽核紀錄裡最大的部分，列表不帶，展開時才向 `GET /audit-logs/:id` 取。
 */
export function AuditLogDetail({ id }: AuditLogDetailProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
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
          <div>
            <p className="m-0 mb-1 text-xs text-[var(--color-fg-muted)]">
              {t('auditLog.detail.changes')}
            </p>
            <pre className="m-0 overflow-x-auto rounded bg-[var(--color-bg)] p-2 font-mono text-xs">
              {JSON.stringify(data.changes, null, 2)}
            </pre>
          </div>
          <div>
            <p className="m-0 mb-1 text-xs text-[var(--color-fg-muted)]">
              {t('auditLog.detail.metadata')}
            </p>
            <pre className="m-0 overflow-x-auto rounded bg-[var(--color-bg)] p-2 font-mono text-xs">
              {JSON.stringify(data.metadata, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
