import type { ColumnPinningState } from '@tanstack/react-table';
import { useCallback, useMemo } from 'react';

import { Pagination } from '@/components/Pagination';
import { createSelectColumn, Table, useTableSelection } from '@/components/Table';
import type { TableProps } from '@/components/Table';
import { useTranslation } from '@/core/locales';
import { ACTIONS_COLUMN_ID } from '@/core/store';
import type { ColumnPinSide } from '@/core/store';
import { cn } from '@/shared/utils';

import { BatchBar } from './BatchBar';
import type { RichTableBatch } from './BatchBar';
import { FilterBar } from './FilterBar';
import type { FilterBarProps } from './FilterBar';
import { createPinColumn, RowPinContext, useRowPinning } from './RowPin';
import { TableSettings } from './TableSettings';
import { useTableSettings } from './TableSettings/useTableSettings';
import type { TableSettingsConfig } from './TableSettings/useTableSettings';

/** 伺服器端分頁的狀態；與 `Pagination` 相同，換頁或改每頁筆數時回報新的 `offset` / `limit`。 */
export interface RichTablePagination {
  offset: number;
  limit: number;
  total: number;
  onChange: (next: { offset: number; limit: number }) => void;
  pageSizeOptions?: number[];
}

/**
 * 這個 id 的欄位（操作欄）固定在原位、不列入欄位設定，但可以設定固定在左側或右側。
 */
const FIXED_COLUMN_ID = ACTIONS_COLUMN_ID;

export interface RichTableProps<
  TData,
  TFilters extends Record<string, unknown> = Record<string, unknown>,
> extends Omit<
  TableProps<TData>,
  'ref' | 'className' | 'classNames' | 'styles' | 'testIds' | 'data-testid' | 'rowPinning'
> {
  /** 不提供時不顯示篩選按鈕。 */
  filters?: FilterBarProps<TFilters>;
  /** 不提供時不顯示欄位設定按鈕，欄位照 `columns` 原樣顯示。 */
  settings?: TableSettingsConfig;
  /**
   * 釘選欄（PinColumn）：每一列有釘選選單（頂端／底端），釘選的列貼在該側、換頁排序都不動，並記在偏好裡。
   * 預設提供但隱藏，使用者在欄位設定裡打開；需要 `settings.tableId` 與 `getRowId`，`false` 完全不提供。
   */
  enableRowPinning?: boolean;
  /**
   * 勾選欄（CheckboxColumn）：預設提供並固定在 start。沒傳 `rowSelection` / `onRowSelectionChange` 時
   * 由 RichTable 自己管理（跨頁保留）；要做批次操作的頁面用 `useTableSelection` 接手控制。`false` 不提供。
   */
  enableRowSelection?: boolean;
  /**
   * 批次操作：勾選後在表格上方出現操作列（`BatchActionBar`），確認、送出、結果提示都由 RichTable 處理。
   * 提供時以 `batch.selection` 控制勾選欄，不必另外傳 `rowSelection` / `onRowSelectionChange`。
   */
  batch?: RichTableBatch<TData>;
  /** 不提供時不顯示分頁列（例如資料量固定的小表格）。 */
  pagination?: RichTablePagination;
  /** 落在最外層容器。 */
  className?: string;
  /** 落在最外層容器；表格與分頁列各自保留設計系統的預設 testid。 */
  'data-testid'?: string;
}

/**
 * 列表頁用的表格：把 `Table` 與 `Pagination` 組在一起，並以目前語系補上空狀態與分頁的預設文案。
 * 放在 `core/` 而不是 `components/`，因為它依賴 `core/locales`（docs/conventions/02-frontend.md §8）。
 * 篩選（`FilterBar`）與欄位設定（`TableSettings`）都是下拉面板，按鈕固定在最後一欄表頭的右下角
 * （`Table` 的 `headerTrailing`），該欄標題被擠壓時裁掉。
 */
export function RichTable<TData, TFilters extends Record<string, unknown>>({
  columns,
  filters,
  settings,
  pagination,
  enableRowPinning = true,
  enableRowSelection = true,
  batch,
  emptyTitle,
  className,
  'data-testid': testId,
  ...tableProps
}: RichTableProps<TData, TFilters>) {
  const { t } = useTranslation();
  const pin = useRowPinning({
    tableId: settings?.tableId,
    enabled: enableRowPinning,
    data: tableProps.data,
    getRowId: tableProps.getRowId,
  });
  // 勾選欄（CheckboxColumn）：呼叫端沒接手時由這裡管理選取；沒有 getRowId 時與 TanStack 一樣用索引當 id
  const indexRowId = useCallback((row: TData) => String(pin.data.indexOf(row)), [pin.data]);
  const rowId = tableProps.getRowId ?? indexRowId;
  const internalSelection = useTableSelection(pin.data, rowId);
  // 選取的來源：批次操作的 selection → 呼叫端自己控制 → RichTable 內部
  const selection = batch?.selection ?? internalSelection;
  const controlled = !batch && tableProps.onRowSelectionChange !== undefined;
  const selectable = enableRowSelection;
  const rowSelection = controlled ? tableProps.rowSelection : selection.rowSelection;
  const onRowSelectionChange = controlled
    ? tableProps.onRowSelectionChange
    : selection.onRowSelectionChange;

  // 工具欄排在最前面，和一般欄位一起進欄位設定（預設值見 core/store 的 DEFAULT_PINNED_COLUMNS / DEFAULT_HIDDEN_COLUMNS）。
  // 依賴放翻譯後的字串而不是 t（每次渲染都是新函式）：欄位定義一換，flexRender 會重新掛載勾選框
  const selectColumnLabel = t('common.selectColumn');
  const selectAllLabel = t('common.selectAll');
  const selectRowLabel = t('common.selectRow');
  const pinColumnLabel = t('common.pinColumn');
  const allColumns = useMemo(
    () => [
      ...(selectable
        ? [
            createSelectColumn<TData>({
              column: selectColumnLabel,
              selectAll: selectAllLabel,
              selectRow: selectRowLabel,
            }),
          ]
        : []),
      ...(pin.active ? [createPinColumn<TData>(pinColumnLabel)] : []),
      ...columns,
    ],
    [
      columns,
      pin.active,
      pinColumnLabel,
      selectAllLabel,
      selectColumnLabel,
      selectRowLabel,
      selectable,
    ],
  );
  const {
    columns: displayedColumns,
    value: tableSettings,
    settingsProps,
  } = useTableSettings(allColumns, settings, FIXED_COLUMN_ID);
  const hasTools = Boolean(filters || settingsProps);

  // 依目前的欄位順序排出左右兩側的固定欄位（TanStack 依陣列順序排列）
  const columnPinning = useMemo<ColumnPinningState>(() => {
    const idsOf = (side: ColumnPinSide) =>
      displayedColumns.flatMap((column) =>
        column.id && tableSettings.pinnedColumns[column.id] === side ? [column.id] : [],
      );
    return { left: idsOf('start'), right: idsOf('end') };
  }, [displayedColumns, tableSettings.pinnedColumns]);

  const tools = hasTools ? (
    <>
      {filters && <FilterBar {...filters} />}
      {settingsProps && <TableSettings {...settingsProps} />}
    </>
  ) : null;

  return (
    <div className={cn('flex flex-col gap-4', className)} data-testid={testId}>
      {batch && selectable && <BatchBar batch={batch} getRowId={rowId} />}
      <RowPinContext value={pin.contextValue}>
        <Table
          // 呼叫端明確傳入 columnPinning / stickyHeader 時以它為準
          columnPinning={columnPinning}
          stickyHeader={tableSettings.stickyHeader}
          {...tableProps}
          data={pin.data}
          rowSelection={selectable ? rowSelection : tableProps.rowSelection}
          onRowSelectionChange={selectable ? onRowSelectionChange : tableProps.onRowSelectionChange}
          columns={displayedColumns}
          rowPinning={pin.rowPinning}
          headerTrailing={tools}
          emptyTitle={emptyTitle ?? t('common.empty')}
        />
      </RowPinContext>

      {pagination && (
        <Pagination
          offset={pagination.offset}
          limit={pagination.limit}
          total={pagination.total}
          onChange={pagination.onChange}
          pageSizeOptions={pagination.pageSizeOptions}
          labels={{
            previous: t('common.previous'),
            next: t('common.next'),
            summary: ({ from, to, total }) => `${from}-${to} / ${total}`,
          }}
        />
      )}
    </div>
  );
}
