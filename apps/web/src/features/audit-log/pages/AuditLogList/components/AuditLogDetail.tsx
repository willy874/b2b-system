import { useTranslation } from '@/core/locales';

import type { AuditLogRowVM } from '../adapter';

interface AuditLogDetailProps {
  log: AuditLogRowVM;
}

/** 展開列的明細：變更前後與 metadata 原樣以 JSON 顯示。 */
export function AuditLogDetail({ log }: AuditLogDetailProps) {
  const { t } = useTranslation();

  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      data-testid="audit-log-detail"
    >
      <h2 className="m-0 mb-2 text-sm font-semibold">{t('auditLog.detail.title')}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="m-0 mb-1 text-xs text-[var(--color-fg-muted)]">
            {t('auditLog.detail.changes')}
          </p>
          <pre className="m-0 overflow-x-auto rounded bg-[var(--color-bg)] p-2 font-mono text-xs">
            {JSON.stringify(log.changes, null, 2)}
          </pre>
        </div>
        <div>
          <p className="m-0 mb-1 text-xs text-[var(--color-fg-muted)]">
            {t('auditLog.detail.metadata')}
          </p>
          <pre className="m-0 overflow-x-auto rounded bg-[var(--color-bg)] p-2 font-mono text-xs">
            {JSON.stringify(log.metadata, null, 2)}
          </pre>
        </div>
      </div>
    </section>
  );
}
