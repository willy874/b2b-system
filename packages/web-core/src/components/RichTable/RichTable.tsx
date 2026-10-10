import { Button } from '@b2b-system/ui/Button';
import { Pagination } from '@b2b-system/ui/Pagination';
import { createSelectColumn, Table, useTableSelection } from '@b2b-system/ui/Table';
import type { TableProps } from '@b2b-system/ui/Table';
import { useLatestRef } from '@b2b-system/ui/useLatestRef';
import { cn } from '@b2b-system/web-shared/utils';
import type { ColumnPinningState, RowData } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo } from 'react';

import { useErrorMessage } from '../../errors';
import { useTranslation } from '../../locales';
import { ACTIONS_COLUMN_ID } from '../../store';
import type { ColumnPinSide } from '../../store';
import { QueryError } from '../QueryError';
import { activeFilterFields, ActiveFilters } from './ActiveFilters';
import { BatchBar } from './BatchBar';
import type { RichTableBatch } from './BatchBar';
import { FilterBar } from './FilterBar';
import type { FilterBarProps } from './FilterBar';
import { createPinColumn, RowPinContext, useRowPinning } from './RowPin';
import { TableSearch } from './TableSearch';
import type { TableSearchProps } from './TableSearch';
import { TableSettings } from './TableSettings';
import { useTableSettings } from './TableSettings/useTableSettings';
import type { TableSettingsConfig } from './TableSettings/useTableSettings';

/** 伺服器端分頁的狀態；與 `Pagination` 相同，換頁或改每頁筆數時回報新的 `offset` / `limit`。 */
/**
 * 列表端點接受的最大 offset（`apps/api/src/core/http/pagination.ts` 的 `MAX_OFFSET`）：
 * 超過的頁不列入頁數，否則「最後一頁」會送出 400 的 offset（docs/architecture/backend/06-audit-log.md §7.2）。
 */
export const LIST_MAX_OFFSET = 10_000;

export interface RichTablePagination {
  offset: number;
  limit: number;
  total: number;
  onChange: (next: { offset: number; limit: number }) => void;
  pageSizeOptions?: number[];
  /** 預設 `LIST_MAX_OFFSET`；端點的上限不同時才傳 */
  maxOffset?: number;
  /** `total` 是數到上限就停的數字（稽核日誌）：摘要寫「以上」並提示縮小範圍 */
  totalCapped?: boolean;
}

/**
 * 這個 id 的欄位（操作欄）固定在原位、不列入欄位設定，但可以設定固定在左側或右側。
 */
const FIXED_COLUMN_ID = ACTIONS_COLUMN_ID;

export interface RichTableProps<
  TData extends RowData,
  TFilters extends Record<string, unknown> = Record<string, unknown>,
> extends Omit<
  TableProps<TData>,
  'ref' | 'className' | 'classNames' | 'styles' | 'testIds' | 'data-testid' | 'rowPinning'
> {
  /** 不提供時不顯示篩選按鈕。套用中的條件會以可移除的 Chip 列在表格上方。 */
  filters?: FilterBarProps<TFilters>;
  /** 常駐在表格上方的關鍵字搜尋（輸入停頓後才送出）；不提供時不顯示。 */
  search?: TableSearchProps;
  /**
   * 查詢失敗（通常是 query 的 `error`）。沒有資料時以錯誤畫面取代表格，有舊資料時保留表格並在上方提示；
   * 不會落到「沒有資料」的空狀態。
   */
  error?: unknown;
  /** 錯誤畫面的「重試」（通常是 query 的 `refetch`）。 */
  onRetry?: () => void;
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
   * 批次操作：勾選後在表格上方出現操作列（`BatchActionBar`），確認後送進全域佇列逐筆處理，
   * 進行中時操作列換成進度條。提供時以 `batch.selection` 控制勾選欄，不必另外傳 `rowSelection` / `onRowSelectionChange`。
   */
  batch?: RichTableBatch<TData>;
  /** 不提供時不顯示分頁列（例如資料量固定的小表格）。 */
  pagination?: RichTablePagination;
  /**
   * 填滿父層（flex 欄）的剩餘高度（預設開啟）：表格延展並在框內捲動，分頁列固定在底部。
   * 父層要是有高度上限的 flex 欄——列表頁的根元素給 `flex-1 min-h-0`（DashboardLayout 的主內容是 flex 欄）。
   */
  fillHeight?: boolean;
  /** 落在最外層容器。 */
  className?: string;
  /** 落在最外層容器；表格與分頁列各自保留設計系統的預設 testid。 */
  'data-testid'?: string;
}

/**
 * 列表頁用的表格：把 `Table` 與 `Pagination` 組在一起，並以目前語系補上空狀態與分頁的預設文案。
 * 放在 web-core 而不是 `@b2b-system/ui`，因為它依賴 `locales`（docs/coding-standards/02-frontend.md §8）。
 * 篩選（`FilterBar`）與欄位設定（`TableSettings`）都是下拉面板，按鈕固定在最後一欄表頭的右側（與標題垂直置中）
 * （`Table` 的 `headerTrailing`），該欄標題被擠壓時裁掉。
 */
export function RichTable<TData extends RowData, TFilters extends Record<string, unknown>>({
  columns,
  filters,
  settings,
  pagination,
  enableRowPinning = true,
  enableRowSelection = true,
  fillHeight = true,
  batch,
  emptyTitle,
  emptyDescription,
  search,
  error,
  onRetry,
  className,
  'data-testid': testId,
  ...tableProps
}: RichTableProps<TData, TFilters>) {
  const { t, language } = useTranslation();
  const toMessage = useErrorMessage();
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

  // 工具欄排在最前面，和一般欄位一起進欄位設定（預設值見 store 的 DEFAULT_PINNED_COLUMNS / DEFAULT_HIDDEN_COLUMNS）。
  // 依賴放翻譯後的字串而不是 t：任何語系包載入完成時 t 都會換新（未必動到這幾個字），欄位定義一換，flexRender 會重新掛載勾選框
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

  // 依目前的欄位順序排出 start／end 兩側的固定欄位（TanStack 依陣列順序排列）
  const columnPinning = useMemo<ColumnPinningState>(() => {
    const idsOf = (side: ColumnPinSide) =>
      displayedColumns.flatMap((column) =>
        column.id && tableSettings.pinnedColumns[column.id] === side ? [column.id] : [],
      );
    return { start: idsOf('start'), end: idsOf('end') };
  }, [displayedColumns, tableSettings.pinnedColumns]);

  const tools = hasTools ? (
    <>
      {filters && <FilterBar {...filters} />}
      {settingsProps && <TableSettings {...settingsProps} />}
    </>
  ) : null;

  const hasError = error !== undefined && error !== null;
  const loading = tableProps.loading ?? false;
  const filtered = activeFilterFields(filters).length > 0 || Boolean(search?.value);
  const clearFilters = () => {
    if (filters?.defaultValue) {
      // 排序不是篩選：保留目前的排序，只清掉條件
      const kept = Object.fromEntries(
        filters.fields.flatMap((field) =>
          field.type === 'sort' ? [[field.key, filters.value[field.key]]] : [],
        ),
      );
      // 關鍵字通常也在 filters.value 裡，一次送出；分兩次導覽會互相蓋掉
      filters.onSubmit({ ...filters.defaultValue, ...kept });
    } else {
      search?.onChange(undefined);
    }
  };

  // 刪到最後一頁沒有資料時（offset 超過總數）退回最後一頁，而不是停在「沒有資料」
  const overflowOffset =
    pagination &&
    !loading &&
    !hasError &&
    pagination.total > 0 &&
    pagination.offset >= pagination.total
      ? Math.floor((pagination.total - 1) / pagination.limit) * pagination.limit
      : undefined;
  const pageLimit = pagination?.limit;
  const onPageChange = useLatestRef(pagination?.onChange);
  useEffect(() => {
    if (overflowOffset === undefined || pageLimit === undefined) return;
    onPageChange.current?.({ offset: overflowOffset, limit: pageLimit });
  }, [onPageChange, overflowOffset, pageLimit]);

  const numberFormat = useMemo(() => new Intl.NumberFormat(language || undefined), [language]);

  return (
    <div
      className={cn('flex flex-col gap-4', fillHeight && 'min-h-0 flex-1', className)}
      data-testid={testId}
    >
      {(search || filtered) && (
        <div className="flex flex-wrap items-center gap-2">
          {search && <TableSearch {...search} />}
          {filters && <ActiveFilters filters={filters} />}
        </div>
      )}
      {batch && selectable && <BatchBar batch={batch} getRowId={rowId} pageRows={pin.data} />}
      {hasError && pin.data.length > 0 && (
        // 有舊資料（keepPreviousData）時保留表格，只提示這次沒有更新成功
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning)] px-3 py-2 text-sm"
          data-testid="rich-table-stale"
        >
          <span>{t('common.staleData', { message: toMessage(error) })}</span>
          {onRetry && (
            <Button size="sm" onClick={onRetry} data-testid="query-error-retry">
              {t('common.retry')}
            </Button>
          )}
        </div>
      )}
      {hasError && pin.data.length === 0 ? (
        <QueryError
          error={error}
          onRetry={onRetry}
          className="flex-1"
          data-testid="rich-table-error"
        />
      ) : (
        <RowPinContext value={pin.contextValue}>
          <Table
            // 呼叫端明確傳入 columnPinning / stickyHeader 時以它為準
            columnPinning={columnPinning}
            stickyHeader={tableSettings.stickyHeader}
            {...tableProps}
            data={pin.data}
            rowSelection={selectable ? rowSelection : tableProps.rowSelection}
            onRowSelectionChange={
              selectable ? onRowSelectionChange : tableProps.onRowSelectionChange
            }
            columns={displayedColumns}
            rowPinning={pin.rowPinning}
            fillHeight={fillHeight}
            headerTrailing={tools}
            // 有篩選卻沒有結果：說清楚是「沒有符合條件」並提供清除，不要和真的沒資料混在一起
            emptyTitle={emptyTitle ?? (filtered ? t('common.emptyFiltered') : t('common.empty'))}
            emptyDescription={
              emptyDescription ??
              (filtered && (filters?.defaultValue || search) ? (
                <Button size="sm" onClick={clearFilters} data-testid="rich-table-clear-filters">
                  {t('common.clearFilters')}
                </Button>
              ) : undefined)
            }
          />
        </RowPinContext>
      )}

      {pagination && (
        <Pagination
          className="shrink-0"
          offset={pagination.offset}
          limit={pagination.limit}
          total={pagination.total}
          onChange={pagination.onChange}
          pageSizeOptions={pagination.pageSizeOptions}
          maxOffset={pagination.maxOffset ?? LIST_MAX_OFFSET}
          labels={{
            summary: ({ from, to, total }) =>
              pagination.totalCapped
                ? t('common.paginationSummaryCapped', {
                    from: numberFormat.format(from),
                    to: numberFormat.format(to),
                    total: numberFormat.format(total),
                  })
                : t('common.paginationSummary', {
                    from: numberFormat.format(from),
                    to: numberFormat.format(to),
                    total: numberFormat.format(total),
                  }),
          }}
        />
      )}
    </div>
  );
}
