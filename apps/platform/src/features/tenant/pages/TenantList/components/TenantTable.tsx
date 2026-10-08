import type { TableColumnDef } from '@b2b-system/ui/Table';
import { RichTable } from '@b2b-system/web-core/components';
import type {
  FilterBarProps,
  RichTablePagination,
  TableSearchProps,
  TableSettingsConfig,
} from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import type { SortEntry } from '@b2b-system/web-shared/constants';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { cn, formatBytes } from '@b2b-system/web-shared/utils';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import type { TenantSortField } from '@/apis/platform-tenant/types';

import { TenantStatus } from '../../../components/TenantStatus';
import { TENANT_LIST_TABLE_ID } from '../../../preference';
import {
  DEFAULT_TENANT_DETAIL_SEARCH,
  TENANT_SORT_FIELDS,
  TenantDetailRoute,
} from '../../../routes';
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
  sort: Array<SortEntry<TenantSortField>>;
  onSortingChange: (sort: Array<SortEntry<TenantSortField>>) => void;
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
  sort,
  onSortingChange,
  onRowDoubleClick,
}: TenantTableProps) {
  const { t } = useTranslation();

  const columns = useMemo<Array<TableColumnDef<TenantRowVM>>>(
    () => [
      {
        id: 'code',
        header: t('tenant.field.code'),
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
      // 用量摘要（docs/architecture/05-tenancy.md §5.4）：還沒彙總過的租戶顯示「-」
      {
        id: 'usersActive',
        header: t('tenant.field.usersActive'),
        cell: ({ row }) => row.original.usersActive?.toLocaleString() ?? '-',
      },
      {
        id: 'storageUsage',
        header: t('tenant.field.storage'),
        cell: ({ row }) => <StorageCell row={row.original} />,
      },
      {
        id: 'recentRequests',
        header: t('tenant.field.recentRequests'),
        cell: ({ row }) => row.original.recentRequests.toLocaleString(),
      },
      {
        id: 'lastActivityAt',
        header: t('tenant.field.lastActivityAt'),
        cell: ({ row }) =>
          row.original.lastActivityAt ? formatDateTime(row.original.lastActivityAt) : '-',
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
      sorting={sort.map((entry) => ({ sortBy: entry.sort, sortOrder: entry.order }))}
      onSortingChange={(sorting) =>
        onSortingChange(
          sorting.flatMap(({ sortBy, sortOrder }) =>
            isSortField(sortBy) ? [{ sort: sortBy, order: sortOrder }] : [],
          ),
        )
      }
      onRowDoubleClick={onRowDoubleClick}
      emptyTitle={filtered ? t('tenant.emptyFiltered') : t('tenant.empty')}
      data-testid="tenant-table"
    />
  );
}

const getRowId = (row: TenantRowVM) => row.id;

function isSortField(value: string): value is TenantSortField {
  return (TENANT_SORT_FIELDS as readonly string[]).includes(value);
}

/** 已用量與使用率；達到警示門檻時以警示色標出。 */
function StorageCell({ row }: { row: TenantRowVM }) {
  if (row.storageUsedBytes === null) return '-';
  const percent = row.storageUsageRatio === null ? null : Math.floor(row.storageUsageRatio * 100);
  return (
    <span
      className={cn(
        'tabular-nums',
        row.isStorageWarning && 'font-medium text-[var(--color-warning-text)]',
      )}
      data-testid="tenant-storage-usage"
      data-value={row.isStorageWarning ? 'warning' : 'normal'}
    >
      {formatBytes(row.storageUsedBytes)}
      {percent !== null && ` (${percent}%)`}
    </span>
  );
}
