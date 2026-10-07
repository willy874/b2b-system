import type { TableColumnDef } from '@b2b-system/ui/Table';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMemo } from 'react';

import type { PlatformJobRowVM } from './adapter';

/** 平台才有的租戶欄（web-core 的 `JobTable` 插在「工作」欄之後）：平台層級的工作顯示「平台」，否則顯示租戶代碼。 */
export function useJobTenantColumn(): Array<TableColumnDef<PlatformJobRowVM>> {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        id: 'tenant',
        header: t('job.field.tenant'),
        enableSorting: false,
        cell: ({ row }) => (
          <span data-testid="job-tenant" data-value={row.original.ownerValue}>
            {row.original.owner.kind === 'platform' ? (
              <span className="text-[var(--color-fg-muted)]">{t('job.tenant.platform')}</span>
            ) : (
              <code className="font-mono text-xs">{row.original.owner.label}</code>
            )}
          </span>
        ),
      },
    ],
    [t],
  );
}
