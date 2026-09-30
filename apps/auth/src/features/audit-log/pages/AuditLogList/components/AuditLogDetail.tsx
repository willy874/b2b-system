import { useTranslation } from '@/core/locales';
import type { PlatformAuditLog } from '@/shared/api-sdk';

/** 展開列的明細：metadata 以縮排的 JSON 顯示，過長時在框內捲動。 */
export function AuditLogDetail({ log }: { log: PlatformAuditLog }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2" data-testid="audit-log-detail" data-value={log.id}>
      {log.errorCode && (
        <p className="m-0 text-sm">
          <span className="text-[var(--color-fg-muted)]">{t('auditLog.detail.errorCode')}：</span>
          <code className="font-mono text-xs" data-testid="audit-log-error-code">
            {log.errorCode}
          </code>
        </p>
      )}
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t('auditLog.detail.metadata')}</p>
      {log.metadata ? (
        <pre
          className="m-0 max-h-64 overflow-auto rounded bg-[var(--color-fill-subtle)] p-3 font-mono text-xs"
          data-testid="audit-log-metadata"
        >
          {JSON.stringify(log.metadata, null, 2)}
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
