import { useTranslation } from '@/core/locales';
import type { PlatformTenant } from '@/shared/api-sdk';
import { cn } from '@/shared/utils';

import { TENANT_STATUS_DOT_CLASS, TENANT_STATUS_LABEL_KEY } from '../constants';

export function TenantStatus({ status }: { status: PlatformTenant['status'] }) {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm"
      data-testid="tenant-status"
      data-value={status}
    >
      <span
        className={cn('inline-block h-2 w-2 rounded-full', TENANT_STATUS_DOT_CLASS[status])}
        aria-hidden
      />
      {t(TENANT_STATUS_LABEL_KEY[status])}
    </span>
  );
}
