import { AlertDialog } from '@b2b-system/ui/AlertDialog';
import { Button, IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Table } from '@b2b-system/ui/Table';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { QueryError } from '@b2b-system/web-core/components';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getIdentityProviderListQueryOptions } from '@/apis/identity-provider/get-identity-provider-list/query';
import type { IdentityProvider } from '@/shared/api-sdk';

import { useDeleteIdentityProviderMutation } from '../../hooks/useIdentityProviderMutations';
import { useIdentityProviderPermission } from '../../hooks/useIdentityProviderPermission';
import { KIND_LABEL_KEY } from './adapter';
import { IdentityProviderFormDialog } from './components/IdentityProviderFormDialog';
import { RegistrationUrls } from './components/RegistrationUrls';

/**
 * 租戶的外部 IdP 連線（docs/architecture/04-sso.md §3.3、§12.2 D8–D11）：
 * 連線清單（OIDC、SAML 2.0）、網域與要登記在外部 IdP 的 redirect URI／ACS；client secret 只寫不讀。
 */
export default function IdentityProviderListPage() {
  const { t } = useTranslation();
  const permission = useIdentityProviderPermission();
  const showError = useErrorToast();
  const remove = useDeleteIdentityProviderMutation();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<IdentityProvider>();
  const [removing, setRemoving] = useState<IdentityProvider>();

  const { data, isPending, error, refetch } = useQuery(getIdentityProviderListQueryOptions());

  const columns = useMemo<Array<TableColumnDef<IdentityProvider>>>(
    () => [
      {
        id: 'name',
        header: t('identityProvider.field.name'),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="flex items-center gap-2 font-medium">
              {row.original.name}
              <code
                className="rounded bg-[var(--color-fill-subtle)] px-1 font-mono text-xs font-normal"
                data-testid="identity-provider-kind"
                data-value={row.original.protocol}
              >
                {row.original.protocol === 'saml'
                  ? t('identityProvider.protocol.saml')
                  : t(KIND_LABEL_KEY[row.original.preset])}
              </code>
            </span>
            <span className="text-xs text-[var(--color-fg-muted)]">{row.original.issuer}</span>
          </div>
        ),
      },
      {
        id: 'domains',
        header: t('identityProvider.field.domains'),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.domains.map((item) => (
              <code
                key={item.domain}
                className="rounded bg-[var(--color-fill-subtle)] px-1 font-mono text-xs"
                data-testid="identity-provider-domain"
                data-value={item.domain}
              >
                {item.domain}
                {item.ssoOnly && ` · ${t('identityProvider.ssoOnlyBadge')}`}
              </code>
            ))}
          </div>
        ),
      },
      {
        id: 'status',
        header: t('identityProvider.field.status'),
        cell: ({ row }) =>
          row.original.enabled ? t('identityProvider.enabled') : t('identityProvider.disabled'),
      },
      {
        id: 'updatedAt',
        header: t('identityProvider.field.updatedAt'),
        cell: ({ row }) => formatDateTime(row.original.updatedAt),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex gap-1">
            {permission.canUpdate && (
              <Tooltip content={t('identityProvider.edit.action')}>
                <IconButton
                  size="sm"
                  aria-label={t('identityProvider.edit.action')}
                  onClick={() => {
                    setEditing(row.original);
                    setFormOpen(true);
                  }}
                  data-testid="identity-provider-edit"
                  data-value={row.original.name}
                >
                  <Icon name="edit" size={16} />
                </IconButton>
              </Tooltip>
            )}
            {permission.canDelete && (
              <Tooltip content={t('identityProvider.remove.action')}>
                <IconButton
                  size="sm"
                  aria-label={t('identityProvider.remove.action')}
                  onClick={() => setRemoving(row.original)}
                  data-testid="identity-provider-remove"
                  data-value={row.original.name}
                >
                  <Icon name="trash" size={16} />
                </IconButton>
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [permission.canDelete, permission.canUpdate, t],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="identity-provider-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('identityProvider.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            {t('identityProvider.description')}
          </p>
        </div>
        {permission.canCreate && (
          <Button
            variant="primary"
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
            data-testid="identity-provider-create-button"
          >
            {t('identityProvider.create.action')}
          </Button>
        )}
      </header>

      {data && <RegistrationUrls callbackUrl={data.callbackUrl} samlAcsUrl={data.samlAcsUrl} />}

      {/* 查詢失敗而且沒有舊資料：顯示錯誤與重試，不落到「還沒有任何外部 IdP 連線」 */}
      {error && !data ? (
        <QueryError
          error={error}
          onRetry={() => void refetch()}
          data-testid="identity-provider-error"
        />
      ) : (
        <Table
          data={data?.items ?? []}
          columns={columns}
          getRowId={(row) => row.id}
          loading={isPending}
          emptyTitle={t('identityProvider.empty')}
        />
      )}

      <IdentityProviderFormDialog
        open={formOpen}
        provider={editing}
        onClose={() => setFormOpen(false)}
      />
      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(undefined)}
        title={t('identityProvider.remove.title')}
        description={t('identityProvider.remove.confirm', { name: removing?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={remove.isPending}
        onConfirm={async () => {
          if (!removing) return;
          await remove.mutateAsync({ params: { id: removing.id } }).catch(showError);
          setRemoving(undefined);
        }}
      />
    </div>
  );
}
