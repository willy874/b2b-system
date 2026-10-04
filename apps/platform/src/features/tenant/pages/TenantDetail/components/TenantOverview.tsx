import { useTranslation } from '@/core/locales';
import type { PlatformTenant } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { toTenantOverviewVM } from '../adapter';
import { TenantDomains } from './TenantDomains';

interface TenantOverviewProps {
  tenant: PlatformTenant;
  canUpdate: boolean;
}

/** 概覽分頁：基本資料與網域。 */
export function TenantOverview({ tenant, canUpdate }: TenantOverviewProps) {
  const { t } = useTranslation();
  const info = toTenantOverviewVM(tenant);
  return (
    <div className="flex flex-col gap-4" data-testid="tenant-overview">
      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <dl className="m-0 grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--color-fg-muted)]">{t('tenant.field.code')}</dt>
          <dd className="m-0 font-mono" data-testid="tenant-code">
            {info.code}
          </dd>
          <dt className="text-[var(--color-fg-muted)]">{t('tenant.field.adminEmail')}</dt>
          <dd className="m-0">{info.adminEmail ?? '-'}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('tenant.field.storageBucket')}</dt>
          <dd className="m-0 font-mono">{info.storageBucket}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('tenant.field.createdAt')}</dt>
          <dd className="m-0">{formatDateTime(info.createdAt)}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('tenant.field.provisionedAt')}</dt>
          <dd className="m-0">{info.provisionedAt ? formatDateTime(info.provisionedAt) : '-'}</dd>
        </dl>
      </section>
      <TenantDomains tenant={tenant} canUpdate={canUpdate} />
    </div>
  );
}
