import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { getTenantQueryOptions } from '@/apis/platform-tenant/get-tenant/query';
import { AlertDialog } from '@/components/AlertDialog';
import { Button, IconButton } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { Tooltip } from '@/components/Tooltip';
import { useErrorMessage, useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { PlatformTenant } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { TenantStatus } from '../../components/TenantStatus';
import { TENANT_DOMAIN_PATTERN } from '../../constants';
import {
  useAddTenantDomainMutation,
  useDeleteTenantMutation,
  useDisableTenantMutation,
  useEnableTenantMutation,
  useRemoveTenantDomainMutation,
  useRetryTenantProvisioningMutation,
  useUpdateTenantMutation,
} from '../../hooks/useTenantMutations';
import { useTenantPermission } from '../../hooks/useTenantPermission';
import { TenantDetailRoute, TenantListRoute } from '../../routes';

type Confirming = 'disable' | 'remove' | undefined;

/**
 * 一個租戶（docs/adr/0020-physical-tenant-isolation.md D12、D13）：佈建狀態與失敗原因、網域、停用與刪除。
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
  const remove = useDeleteTenantMutation();
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
      <Link to={TenantListRoute.to} className="text-sm" data-testid="tenant-back">
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
      <ExternalIdpSwitch tenant={tenant} canUpdate={permission.canUpdate} />

      <RenameDialog open={renaming} tenant={tenant} onClose={() => setRenaming(false)} />
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
      <AlertDialog
        open={confirming === 'remove'}
        onOpenChange={(open) => !open && setConfirming(undefined)}
        title={t('tenant.remove.title')}
        description={t('tenant.remove.confirm', { code: tenant.code })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync({ params: { id } });
            setConfirming(undefined);
            void navigate({ to: TenantListRoute.to });
          } catch (caught) {
            showError(caught);
            setConfirming(undefined);
          }
        }}
      />
    </div>
  );
}

/** 網域：第一個是主要網域（信中連結與進入租戶用它）；至少保留一個。 */
function TenantDomains({ tenant, canUpdate }: { tenant: PlatformTenant; canUpdate: boolean }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const toMessage = useErrorMessage();
  const add = useAddTenantDomainMutation();
  const removeDomain = useRemoveTenantDomainMutation();
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string>();

  const submit = async () => {
    const value = domain.trim().toLowerCase();
    if (!TENANT_DOMAIN_PATTERN.test(value)) {
      setError(t('tenant.error.domainInvalid'));
      return;
    }
    setError(undefined);
    try {
      await add.mutateAsync({ params: { id: tenant.id, body: { domain: value } } });
      setDomain('');
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="m-0 text-base font-medium">{t('tenant.domain.title')}</h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {tenant.domains.map((item, index) => (
          <li
            key={item}
            className="flex items-center gap-2 text-sm"
            data-testid="tenant-domain"
            data-value={item}
          >
            <code className="font-mono">{item}</code>
            {index === 0 && (
              <span className="text-xs text-[var(--color-fg-muted)]">
                {t('tenant.domain.primary')}
              </span>
            )}
            {canUpdate && tenant.domains.length > 1 && (
              <Tooltip content={t('tenant.domain.remove')}>
                <IconButton
                  size="sm"
                  aria-label={t('tenant.domain.remove')}
                  onClick={() =>
                    void removeDomain
                      .mutateAsync({ params: { id: tenant.id, domain: item } })
                      .catch(showError)
                  }
                  data-testid="tenant-domain-remove"
                  data-value={item}
                >
                  <Icon name="trash" size={16} />
                </IconButton>
              </Tooltip>
            )}
          </li>
        ))}
      </ul>
      {canUpdate && (
        <form
          className="flex items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label={t('tenant.domain.add')} error={error} className="flex-1">
            <Input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="portal.example.com"
              data-testid="tenant-domain-input"
            />
          </Field>
          <Button type="submit" loading={add.isPending} data-testid="tenant-domain-add">
            {t('tenant.domain.addAction')}
          </Button>
        </form>
      )}
    </section>
  );
}

/**
 * 是否允許租戶設定外部 IdP 連線（docs/adr/0020-physical-tenant-isolation.md 開放問題 2）：
 * 連線本身由租戶的管理者在自己的 backstage 設定，平台只能開關。
 */
function ExternalIdpSwitch({ tenant, canUpdate }: { tenant: PlatformTenant; canUpdate: boolean }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const update = useUpdateTenantMutation();
  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="m-0 text-base font-medium">{t('tenant.externalIdp.title')}</h2>
      <Checkbox
        checked={tenant.allowExternalIdp}
        disabled={!canUpdate || update.isPending}
        onCheckedChange={(checked) =>
          void update
            .mutateAsync({ params: { id: tenant.id, body: { allowExternalIdp: checked } } })
            .catch(showError)
        }
        label={t('tenant.externalIdp.allow')}
        description={t('tenant.externalIdp.description')}
        data-testid="tenant-allow-external-idp"
      />
    </section>
  );
}

function RenameDialog({
  open,
  tenant,
  onClose,
}: {
  open: boolean;
  tenant: PlatformTenant;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const update = useUpdateTenantMutation();
  const [name, setName] = useState(tenant.name);
  const [error, setError] = useState<string>();
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(tenant.name);
      setError(undefined);
    }
  }

  const submit = async () => {
    if (!name.trim()) {
      setError(t('tenant.error.nameRequired'));
      return;
    }
    try {
      await update.mutateAsync({ params: { id: tenant.id, body: { name: name.trim() } } });
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('tenant.rename.title')}
      data-testid="tenant-rename-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={update.isPending}
            onClick={() => void submit()}
            data-testid="tenant-rename-submit"
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('tenant.field.name')} required error={error}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            data-testid="tenant-rename-input"
          />
        </Field>
      </form>
    </Dialog>
  );
}
