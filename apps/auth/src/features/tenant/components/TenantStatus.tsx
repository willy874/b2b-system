import { Chip } from '@/components/Chip';
import { useTranslation } from '@/core/locales';
import type { PlatformTenant } from '@/shared/api-sdk';

import { TENANT_STATUS_LABEL_KEY, TENANT_STATUS_TONE } from '../constants';

/** 租戶狀態：E2E 以 `tenant-status` 的 `data-value` 判斷目前狀態。 */
export function TenantStatus({ status }: { status: PlatformTenant['status'] }) {
  const { t } = useTranslation();
  return (
    <Chip tone={TENANT_STATUS_TONE[status]} data-testid="tenant-status" data-value={status}>
      {t(TENANT_STATUS_LABEL_KEY[status])}
    </Chip>
  );
}
