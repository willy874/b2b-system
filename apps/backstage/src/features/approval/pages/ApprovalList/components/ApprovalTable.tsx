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
import type { ReactNode } from 'react';

import type { ApprovalSortField } from '@/apis/approval/types';

import { approvalColumns } from '../../../components/approvalColumns';
import { useApprovalPermission } from '../../../hooks/useApprovalPermission';
import { APPROVAL_LIST_TABLE_ID } from '../../../preference';
import { APPROVAL_SORT_FIELDS, ApprovalDetailRoute } from '../../../routes';
import type { ApprovalDetailSearch, ApprovalSearchQuery } from '../../../routes';
import type { ApprovalRowVM } from '../adapter';
import type { ApprovalFilterValues } from '../useApprovalFilters';
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
  /** 詳情連結帶的條件（列表的篩選，加上是否從待審清單進入）。 */
  detailSearch: ApprovalDetailSearch;
  /** 省略時用表格的預設（有篩選時是「沒有符合的結果」與清除篩選）。 */
  emptyTitle?: string;
  emptyDescription?: ReactNode;
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
  detailSearch,
  emptyTitle,
  emptyDescription,
  filters,
  batch,
  pagination,
}: ApprovalTableProps) {
  const { t } = useTranslation();
  // 沒有審核權限（或權限未水合）時整欄不出現，而不是一欄空白
  const { hydrated, canReview } = useApprovalPermission();
  const showActions = hydrated && canReview;

  const columns = useMemo<Array<TableColumnDef<ApprovalRowVM>>>(() => {
    const shared = approvalColumns<ApprovalRowVM>({
      t,
      renderTypeLink: (row, label) => (
        <Link
          to={ApprovalDetailRoute.to}
          params={{ approvalId: row.id }}
          search={detailSearch}
          className="font-medium whitespace-nowrap text-[var(--color-brand)]"
          data-testid="approval-detail-link"
          data-value={row.requesterName}
        >
          {label}
        </Link>
      ),
      statusTestId: 'approval-status',
      createdAtSortable: true,
    });
    return [
      shared.type,
      shared.requesterName,
      shared.status,
      shared.progress,
      shared.createdAt,
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
    ];
  }, [detailSearch, showActions, t]);

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
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      data-testid="approval-table"
    />
  );
}

const getRowId = (row: ApprovalRowVM) => row.id;

function isSortField(value: string): value is ApprovalSortField {
  return (APPROVAL_SORT_FIELDS as readonly string[]).includes(value);
}
