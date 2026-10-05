import { useTranslation } from '@b2b-system/web-core/locales';

import type { PlatformTenant } from '@/shared/api-sdk';

interface TenantNoticesProps {
  tenant: Pick<PlatformTenant, 'status' | 'provisionError'>;
}

/** 佈建中的說明、佈建失敗的原因，或佈建完成但後續步驟（啟用信、bucket）失敗的提醒。 */
export function TenantNotices({ tenant }: TenantNoticesProps) {
  const { t } = useTranslation();
  return (
    <>
      {tenant.status === 'provisioning' && (
        <p className="m-0 text-sm text-[var(--color-fg-muted)]" data-testid="tenant-provisioning">
          {t('tenant.provisioningHint')}
        </p>
      )}
      {tenant.provisionError && tenant.status === 'failed' && (
        <p
          role="alert"
          className="m-0 rounded-[var(--radius-md)] border border-[var(--color-danger)] p-3 text-sm text-[var(--color-danger-text)]"
          data-testid="tenant-provision-error"
        >
          {t('tenant.provisionError', { reason: tenant.provisionError })}
        </p>
      )}
      {/* 租戶可以用，只是要留意 */}
      {tenant.provisionError && tenant.status !== 'failed' && (
        <p
          className="m-0 rounded-[var(--radius-md)] border border-[var(--color-warning)] p-3 text-sm"
          data-testid="tenant-provision-warning"
        >
          {t('tenant.provisionWarning', { reason: tenant.provisionError })}
        </p>
      )}
    </>
  );
}
