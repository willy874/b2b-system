import { useTranslation } from '@/core/locales';

import type { AuditLogRowVM } from '../adapter';

/** 展開列的明細：錯誤碼與 metadata（縮排的 JSON，過長時在框內捲動）。列表已帶 metadata，不需要再向後端取。 */
export function AuditLogDetail({ row }: { row: AuditLogRowVM }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2" data-testid="audit-log-detail" data-value={row.id}>
      <h2 className="m-0 text-sm font-semibold">{t('auditLog.detail.title')}</h2>
      {row.errorCode && (
        <p className="m-0 text-sm">
          <span className="text-[var(--color-fg-muted)]">{t('auditLog.detail.errorCode')}：</span>
          <code className="font-mono text-xs" data-testid="audit-log-error-code">
            {row.errorCode}
          </code>
        </p>
      )}
      {row.resourceId && (
        <p className="m-0 text-sm">
          <span className="text-[var(--color-fg-muted)]">{t('auditLog.detail.resourceId')}：</span>
          <code className="font-mono text-xs">{row.resourceId}</code>
        </p>
      )}
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t('auditLog.detail.metadata')}</p>
      {row.metadata ? (
        <pre
          className="m-0 max-h-64 overflow-auto rounded-[var(--radius-md)] bg-[var(--color-fill-subtle)] p-3 font-mono text-xs"
          data-testid="audit-log-metadata"
        >
          {JSON.stringify(row.metadata, null, 2)}
        </pre>
      ) : (
        <p
          className="m-0 text-sm text-[var(--color-fg-muted)]"
          data-testid="audit-log-metadata-empty"
        >
          {t('auditLog.detail.noMetadata')}
        </p>
      )}
    </section>
  );
}
