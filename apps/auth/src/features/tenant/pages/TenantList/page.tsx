import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { getTenantListQueryOptions } from '@/apis/platform-tenant/get-tenant-list/query';
import { Button } from '@/components/Button';
import { Pagination } from '@/components/Pagination';
import { Table } from '@/components/Table';
import { useTranslation } from '@/core/locales';
import type { PlatformTenant } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { TenantStatus } from '../../components/TenantStatus';
import { TENANT_PAGE_SIZE_OPTIONS } from '../../constants';
import { useTenantPermission } from '../../hooks/useTenantPermission';
import { TenantDetailRoute, TenantListRoute } from '../../routes';
import type { TenantSearchQuery } from '../../routes';
import { CreateTenantDialog } from './components/CreateTenantDialog';
import { TenantFilterBar } from './components/TenantFilterBar';
import type { TenantFilterValues } from './components/TenantFilterBar';

/**
 * 平台管理者的租戶清單（docs/adr/0020-physical-tenant-isolation.md D12、D13）：
 * 代碼、名稱、狀態、主要網域；點進去看詳情與停用、刪除。
 * 伺服器分頁、代碼／名稱／網域搜尋與狀態篩選，條件放在網址上（routes/model.ts）。
 */
export default function TenantListPage() {
  const { t } = useTranslation();
  const permission = useTenantPermission();
  const navigate = useNavigate();
  const search = TenantListRoute.useSearch();
  const [creating, setCreating] = useState(false);
  const { data, isPending } = useQuery(
    getTenantListQueryOptions({
      offset: search.offset,
      limit: search.limit,
      q: search.q,
      status: search.status,
    }),
  );
  const filtered = Boolean(search.q || search.status);

  const patch = (next: Partial<TenantSearchQuery>) =>
    void navigate({ to: TenantListRoute.to, search: { ...search, ...next } });
  // 條件一起覆寫（重設時全部是 undefined）；條件變了就回第一頁
  const applyFilters = ({ q, status }: TenantFilterValues) => patch({ q, status, offset: 0 });
  const setPage = ({ offset, limit }: { offset: number; limit: number }) =>
    patch({ offset, limit });

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

      <TenantFilterBar key={search.q ?? ''} search={search} onChange={applyFilters} />

      <Table
        data={data?.items ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        loading={isPending}
        emptyTitle={filtered ? t('tenant.emptyFiltered') : t('tenant.empty')}
        data-testid="tenant-table"
      />

      <Pagination
        offset={search.offset}
        limit={search.limit}
        total={data?.pagination.total ?? 0}
        pageSizeOptions={TENANT_PAGE_SIZE_OPTIONS}
        onChange={setPage}
        labels={{
          previous: t('common.previous'),
          next: t('common.next'),
          summary: ({ from, to, total }) => t('tenant.pagination.summary', { from, to, total }),
        }}
        data-testid="tenant-pagination"
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
