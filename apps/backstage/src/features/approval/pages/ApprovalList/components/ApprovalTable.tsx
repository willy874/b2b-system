import { Chip } from '@b2b-system/ui/Chip';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { RichTable } from '@b2b-system/web-core/components';
import type {
  FilterBarProps,
  RichTableBatch,
  RichTablePagination,
  TableSettingsConfig,
} from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import type { SortEntry } from '@b2b-system/web-shared/constants';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import type { ApprovalSortField } from '@/apis/approval/types';

import {
  APPROVAL_STATUS_LABEL_KEY,
  APPROVAL_STATUS_TONE,
  APPROVAL_TYPE_LABEL_KEY,
} from '../../../constants';
import { useApprovalPermission } from '../../../hooks/useApprovalPermission';
import { APPROVAL_LIST_TABLE_ID } from '../../../preference';
import { APPROVAL_SORT_FIELDS, ApprovalDetailRoute } from '../../../routes';
import type { ApprovalSearchQuery } from '../../../routes';
import type { ApprovalRowVM } from '../adapter';
import type { ApprovalFilterValues } from '../useApprovalFilters';
import { ApprovalProgress } from './ApprovalProgress';
import { ApprovalRowActions } from './ApprovalRowActions';

/** 欄位順序與顯示存在這台裝置（`web-core/store/tableColumnSettings`）；可設定的欄位登記在 `preference.ts`。 */
const APPROVAL_TABLE_SETTINGS: TableSettingsConfig = { tableId: APPROVAL_LIST_TABLE_ID };

interface ApprovalTableProps {
  rows: ApprovalRowVM[];
  loading: boolean;
  /** 查詢失敗：沒有資料時以錯誤與重試取代表格，不落到「沒有資料」。 */
  error: unknown;
  onRetry: () => void;
  search: ApprovalSearchQuery;
  /** 表頭點擊：回報點擊後完整的多欄排序。 */
  onSortingChange: (sort: Array<SortEntry<ApprovalSortField>>) => void;
  onRowDoubleClick: (row: ApprovalRowVM) => void;
  filters: FilterBarProps<ApprovalFilterValues>;
  batch: RichTableBatch<ApprovalRowVM>;
  pagination: RichTablePagination;
}

export function ApprovalTable({
  rows,
  loading,
  error,
  onRetry,
  search,
  onSortingChange,
  onRowDoubleClick,
  filters,
  batch,
  pagination,
}: ApprovalTableProps) {
  const { t } = useTranslation();
  // 沒有審核權限（或權限未水合）時整欄不出現，而不是一欄空白
  const { hydrated, canReview } = useApprovalPermission();
  const showActions = hydrated && canReview;

  const columns = useMemo<Array<TableColumnDef<ApprovalRowVM>>>(
    () => [
      {
        id: 'type',
        header: t('approval.field.type'),
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={ApprovalDetailRoute.to}
            params={{ approvalId: row.original.id }}
            search={search}
            className="font-medium whitespace-nowrap text-[var(--color-brand)]"
            data-testid="approval-detail-link"
            data-value={row.original.requesterName}
          >
            {t(APPROVAL_TYPE_LABEL_KEY[row.original.type])}
          </Link>
        ),
      },
      {
        id: 'requesterName',
        header: t('approval.field.requester'),
        enableSorting: false,
        cell: ({ row }) => row.original.requesterName,
      },
      {
        id: 'status',
        header: t('approval.field.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <Chip
            tone={APPROVAL_STATUS_TONE[row.original.status]}
            data-testid="approval-status"
            data-value={row.original.status}
          >
            {t(APPROVAL_STATUS_LABEL_KEY[row.original.status])}
          </Chip>
        ),
      },
      {
        id: 'progress',
        header: t('approval.field.progress'),
        enableSorting: false,
        cell: ({ row }) => <ApprovalProgress row={row.original} />,
      },
      {
        id: 'createdAt',
        header: t('approval.field.createdAt'),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: 'reviewerName',
        header: t('approval.field.reviewer'),
        enableSorting: false,
        cell: ({ row }) => row.original.reviewerName ?? '-',
      },
      {
        id: 'reviewedAt',
        header: t('approval.field.reviewedAt'),
        cell: ({ row }) => formatDateTime(row.original.reviewedAt),
      },
      ...(showActions
        ? [
            {
              id: 'actions',
              header: t('common.actions'),
              enableSorting: false,
              cell: ({ row }) => <ApprovalRowActions row={row.original} />,
            } satisfies TableColumnDef<ApprovalRowVM>,
          ]
        : []),
    ],
    [search, showActions, t],
  );

  return (
    <RichTable
      data={rows}
      columns={columns}
      loading={loading}
      error={error}
      onRetry={onRetry}
      getRowId={getRowId}
      filters={filters}
      batch={batch}
      settings={APPROVAL_TABLE_SETTINGS}
      pagination={pagination}
      sorting={search.sort.map(({ sort, order }) => ({ sortBy: sort, sortOrder: order }))}
      onSortingChange={(sorting) =>
        onSortingChange(
          sorting.flatMap(({ sortBy, sortOrder }) =>
            isSortField(sortBy) ? [{ sort: sortBy, order: sortOrder }] : [],
          ),
        )
      }
      onRowDoubleClick={onRowDoubleClick}
      data-testid="approval-table"
    />
  );
}

const getRowId = (row: ApprovalRowVM) => row.id;

function isSortField(value: string): value is ApprovalSortField {
  return (APPROVAL_SORT_FIELDS as readonly string[]).includes(value);
}
