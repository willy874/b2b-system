import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { getTenantQueryOptions } from '@/apis/platform-tenant/get-tenant/query';
import { AlertDialog } from '@/components/AlertDialog';
import { Button, IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Tooltip } from '@/components/Tooltip';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { formatDateTime } from '@/shared/date';

import { TenantStatus } from '../../components/TenantStatus';
import {
  useDisableTenantMutation,
  useEnableTenantMutation,
  useRetryTenantProvisioningMutation,
} from '../../hooks/useTenantMutations';
import { useTenantPermission } from '../../hooks/useTenantPermission';
import { DEFAULT_TENANT_SEARCH, TenantDetailRoute, TenantListRoute } from '../../routes';
import { DeleteTenantDialog } from './components/DeleteTenantDialog';
import { RenameTenantDialog } from './components/RenameTenantDialog';
import { TenantDomains } from './components/TenantDomains';
import { TenantFeatures } from './components/TenantFeatures';
import { TenantFlags } from './components/TenantFlags';

type Confirming = 'disable' | 'remove' | undefined;

/**
 * 一個租戶（docs/architecture/05-tenancy.md §10.2 D12、D13）：佈建狀態與失敗原因、網域、外部 IdP 與啟用的功能
 * （docs/architecture/frontend/02-plugin-system.md §9.2 D8）、停用與刪除。
 * 佈建中時詳情每 2 秒重抓一次（`getTenantQueryOptions`）。
 */
export default function TenantDetailPage() {
  const { t } = useTranslation();
  const { id } = TenantDetailRoute.useParams();
  const navigate = useNavigate();
  const permission = useTenantPermission();
  const showError = useErrorToast();
  const { data: tenant, isPending, isError } = useQuery(getTenantQueryOptions(id));
  const retry = useRetryTenantProvisioningMutation();
  const disable = useDisableTenantMutation();
  const enable = useEnableTenantMutation();
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>();

  if (isPending)
    return <p className="text-sm text-[var(--color-fg-muted)]">{t('common.loading')}</p>;
  if (isError) {
    return (
      <p className="text-sm text-[var(--color-danger-text)]" data-testid="tenant-not-found">
        {t('tenant.notFound')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="tenant-detail-page">
      <Link
        to={TenantListRoute.to}
        search={DEFAULT_TENANT_SEARCH}
        className="text-sm"
        data-testid="tenant-back"
      >
        {t('tenant.back')}
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 flex items-center gap-2 text-xl font-semibold">
            <span data-testid="tenant-name">{tenant.name}</span>
            {permission.canUpdate && (
              <Tooltip content={t('tenant.rename.action')}>
                <IconButton
                  size="sm"
                  aria-label={t('tenant.rename.action')}
                  onClick={() => setRenaming(true)}
                  data-testid="tenant-rename"
                >
                  <Icon name="edit" size={16} />
                </IconButton>
              </Tooltip>
            )}
          </h1>
          <TenantStatus status={tenant.status} />
        </div>
        <div className="flex gap-2">
          {permission.canCreate && tenant.status === 'failed' && (
            <Button
              loading={retry.isPending}
              onClick={() => void retry.mutateAsync({ params: { id } }).catch(showError)}
              data-testid="tenant-retry"
            >
              {t('tenant.retry.action')}
            </Button>
          )}
          {permission.canUpdate && tenant.status === 'active' && (
            <Button onClick={() => setConfirming('disable')} data-testid="tenant-disable">
              {t('tenant.disable.action')}
            </Button>
          )}
          {permission.canUpdate && tenant.status === 'disabled' && (
            <Button
              loading={enable.isPending}
              onClick={() => void enable.mutateAsync({ params: { id } }).catch(showError)}
              data-testid="tenant-enable"
            >
              {t('tenant.enable.action')}
            </Button>
          )}
          {permission.canDelete && tenant.status !== 'provisioning' && (
            <Button
              variant="danger"
              onClick={() => setConfirming('remove')}
              data-testid="tenant-remove"
            >
              {t('tenant.remove.action')}
            </Button>
          )}
        </div>
      </header>

      {tenant.status === 'provisioning' && (
        <p className="m-0 text-sm text-[var(--color-fg-muted)]" data-testid="tenant-provisioning">
          {t('tenant.provisioningHint')}
        </p>
      )}
      {tenant.provisionError && tenant.status === 'failed' && (
        <p
          className="m-0 rounded-[var(--radius-md)] border border-[var(--color-danger)] p-3 text-sm text-[var(--color-danger-text)]"
          data-testid="tenant-provision-error"
        >
          {t('tenant.provisionError', { reason: tenant.provisionError })}
        </p>
      )}
      {/* 佈建完成，但後續步驟（啟用信、bucket）失敗：租戶可以用，只是要留意 */}
      {tenant.provisionError && tenant.status !== 'failed' && (
        <p
          className="m-0 rounded-[var(--radius-md)] border border-[var(--color-warning)] p-3 text-sm"
          data-testid="tenant-provision-warning"
        >
          {t('tenant.provisionWarning', { reason: tenant.provisionError })}
        </p>
      )}

      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <dl className="m-0 grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--color-fg-muted)]">{t('tenant.field.code')}</dt>
          <dd className="m-0 font-mono" data-testid="tenant-code">
            {tenant.code}
          </dd>
          <dt className="text-[var(--color-fg-muted)]">{t('tenant.field.adminEmail')}</dt>
          <dd className="m-0">{tenant.adminEmail ?? '-'}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('tenant.field.storageBucket')}</dt>
          <dd className="m-0 font-mono">{tenant.storageBucket}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('tenant.field.createdAt')}</dt>
          <dd className="m-0">{formatDateTime(tenant.createdAt)}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('tenant.field.provisionedAt')}</dt>
          <dd className="m-0">
            {tenant.provisionedAt ? formatDateTime(tenant.provisionedAt) : '-'}
          </dd>
        </dl>
      </section>

      <TenantDomains tenant={tenant} canUpdate={permission.canUpdate} />
      <TenantFeatures tenant={tenant} canUpdate={permission.canUpdate} />
      <TenantFlags tenant={tenant} canUpdate={permission.canUpdate} />

      <RenameTenantDialog open={renaming} tenant={tenant} onClose={() => setRenaming(false)} />
      <AlertDialog
        open={confirming === 'disable'}
        onOpenChange={(open) => !open && setConfirming(undefined)}
        title={t('tenant.disable.title')}
        description={t('tenant.disable.confirm', { code: tenant.code })}
        confirmLabel={t('tenant.disable.action')}
        cancelLabel={t('common.cancel')}
        loading={disable.isPending}
        onConfirm={async () => {
          await disable.mutateAsync({ params: { id } }).catch(showError);
          setConfirming(undefined);
        }}
      />
      <DeleteTenantDialog
        open={confirming === 'remove'}
        tenant={tenant}
        onClose={() => setConfirming(undefined)}
        onDeleted={() => {
          setConfirming(undefined);
          void navigate({ to: TenantListRoute.to, search: DEFAULT_TENANT_SEARCH });
        }}
      />
    </div>
  );
}
