import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { getTenantListQueryOptions } from '@/apis/platform-tenant/get-tenant-list/query';
import { Button } from '@/components/Button';
import { Table } from '@/components/Table';
import { useTranslation } from '@/core/locales';
import type { PlatformTenant } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { TenantStatus } from '../../components/TenantStatus';
import { useTenantPermission } from '../../hooks/useTenantPermission';
import { TenantDetailRoute } from '../../routes';
import { CreateTenantDialog } from './components/CreateTenantDialog';

/**
 * 平台管理者的租戶清單（docs/adr/0020-physical-tenant-isolation.md D12、D13）：
 * 代碼、名稱、狀態、主要網域；點進去看詳情與停用、刪除。
 */
export default function TenantListPage() {
  const { t } = useTranslation();
  const permission = useTenantPermission();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { data, isPending } = useQuery(getTenantListQueryOptions());

  const columns = useMemo<Array<ColumnDef<PlatformTenant, unknown>>>(
    () => [
      {
        id: 'code',
        header: t('tenant.field.code'),
        cell: ({ row }) => (
          <Link
            to={TenantDetailRoute.to}
            params={{ id: row.original.id }}
            className="font-mono font-medium"
            data-testid="tenant-link"
            data-value={row.original.code}
          >
            {row.original.code}
          </Link>
        ),
      },
      { id: 'name', header: t('tenant.field.name'), cell: ({ row }) => row.original.name },
      {
        id: 'status',
        header: t('tenant.field.status'),
        cell: ({ row }) => <TenantStatus status={row.original.status} />,
      },
      {
        id: 'domain',
        header: t('tenant.field.primaryDomain'),
        cell: ({ row }) => (
          <code className="font-mono text-xs">{row.original.domains[0] ?? '-'}</code>
        ),
      },
      {
        id: 'createdAt',
        header: t('tenant.field.createdAt'),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="tenant-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('tenant.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('tenant.description')}</p>
        </div>
        {permission.canCreate && (
          <Button
            variant="primary"
            onClick={() => setCreating(true)}
            data-testid="tenant-create-button"
          >
            {t('tenant.create.action')}
          </Button>
        )}
      </header>

      <Table
        data={data?.items ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        loading={isPending}
        emptyTitle={t('tenant.empty')}
      />

      <CreateTenantDialog
        open={creating}
        baseDomain={data?.baseDomain ?? ''}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          void navigate({ to: TenantDetailRoute.to, params: { id } });
        }}
      />
    </div>
  );
}
