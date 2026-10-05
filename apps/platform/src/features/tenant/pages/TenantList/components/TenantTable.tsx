import type { TableColumnDef } from '@b2b-system/ui/Table';
import { RichTable } from '@b2b-system/web-core/components';
import type {
  FilterBarProps,
  RichTablePagination,
  TableSearchProps,
  TableSettingsConfig,
} from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { TenantStatus } from '../../../components/TenantStatus';
import { TENANT_LIST_TABLE_ID } from '../../../preference';
import { DEFAULT_TENANT_DETAIL_SEARCH, TenantDetailRoute } from '../../../routes';
import type { TenantRowVM } from '../adapter';
import type { TenantFilterValues } from '../useTenantFilters';

/** 欄位順序與顯示存在這台裝置；可設定的欄位登記在 `preference.ts`。 */
const TENANT_TABLE_SETTINGS: TableSettingsConfig = { tableId: TENANT_LIST_TABLE_ID };

interface TenantTableProps {
  rows: TenantRowVM[];
  loading: boolean;
  /** 有搜尋或篩選條件時，空狀態改說「沒有符合條件」。 */
  filtered: boolean;
  filters: FilterBarProps<TenantFilterValues>;
  searchBox: TableSearchProps;
  error: unknown;
  onRetry: () => void;
  pagination: RichTablePagination;
  onRowDoubleClick: (row: TenantRowVM) => void;
}

export function TenantTable({
  rows,
  loading,
  filtered,
  filters,
  searchBox,
  error,
  onRetry,
  pagination,
  onRowDoubleClick,
}: TenantTableProps) {
  const { t } = useTranslation();

  const columns = useMemo<Array<TableColumnDef<TenantRowVM>>>(
    () => [
      {
        id: 'code',
        header: t('tenant.field.code'),
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={TenantDetailRoute.to}
            params={{ id: row.original.id }}
            search={DEFAULT_TENANT_DETAIL_SEARCH}
            className="font-mono font-medium text-[var(--color-brand)]"
            data-testid="tenant-link"
            data-value={row.original.code}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        id: 'name',
        header: t('tenant.field.name'),
        enableSorting: false,
        cell: ({ row }) => row.original.name,
      },
      {
        id: 'status',
        header: t('tenant.field.status'),
        enableSorting: false,
        cell: ({ row }) => <TenantStatus status={row.original.status} />,
      },
      {
        id: 'domain',
        header: t('tenant.field.primaryDomain'),
        enableSorting: false,
        cell: ({ row }) => (
          <code className="font-mono text-xs">{row.original.primaryDomain ?? '-'}</code>
        ),
      },
      {
        id: 'createdAt',
        header: t('tenant.field.createdAt'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
    ],
    [t],
  );

  return (
    <RichTable
      data={rows}
      columns={columns}
      loading={loading}
      getRowId={getRowId}
      enableRowSelection={false}
      filters={filters}
      search={searchBox}
      settings={TENANT_TABLE_SETTINGS}
      error={error}
      onRetry={onRetry}
      pagination={pagination}
      onRowDoubleClick={onRowDoubleClick}
      emptyTitle={filtered ? t('tenant.emptyFiltered') : t('tenant.empty')}
      data-testid="tenant-table"
    />
  );
}

const getRowId = (row: TenantRowVM) => row.id;
