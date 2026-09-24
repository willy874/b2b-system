import { flexRender } from '@tanstack/react-table';
import type { ColumnDef, HeaderContext } from '@tanstack/react-table';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { Pagination } from '@/components/Pagination';
import { Table } from '@/components/Table';
import type { TableProps } from '@/components/Table';
import { useTranslation } from '@/core/locales';
import { cn } from '@/shared/utils';

import { FilterBar } from './FilterBar';
import type { FilterBarProps } from './FilterBar';
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

/** 篩選與欄位設定按鈕預設放進這個 id 的欄位表頭；這一欄本身不列入欄位設定。 */
const DEFAULT_TOOLS_COLUMN_ID = 'actions';

export interface RichTableProps<
  TData,
  TFilters extends Record<string, unknown> = Record<string, unknown>,
> extends Omit<
  TableProps<TData>,
  'ref' | 'className' | 'classNames' | 'styles' | 'testIds' | 'data-testid'
> {
  /** 不提供時不顯示篩選按鈕。 */
  filters?: FilterBarProps<TFilters>;
  /** 不提供時不顯示欄位設定按鈕，欄位照 `columns` 原樣顯示。 */
  settings?: TableSettingsConfig;
  /**
   * 篩選與欄位設定按鈕放進哪一欄的表頭，預設 `actions`（操作欄）。
   * 找不到這一欄時，改放在表格右上方。
   */
  toolsColumnId?: string;
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
 * 篩選（`FilterBar`）與欄位設定（`TableSettings`）都是下拉面板，按鈕放在操作欄的表頭。
 */
export function RichTable<TData, TFilters extends Record<string, unknown>>({
  columns,
  filters,
  settings,
  toolsColumnId = DEFAULT_TOOLS_COLUMN_ID,
  pagination,
  emptyTitle,
  className,
  'data-testid': testId,
  ...tableProps
}: RichTableProps<TData, TFilters>) {
  const { t } = useTranslation();
  const { columns: displayedColumns, settingsProps } = useTableSettings(
    columns,
    settings,
    toolsColumnId,
  );
  const hasTools = Boolean(filters || settingsProps);

  const toolsColumn = displayedColumns.find((column) => column.id === toolsColumnId);
  const columnsWithTools = useMemo(
    () =>
      displayedColumns.map((column): ColumnDef<TData, unknown> =>
        column.id === toolsColumnId
          ? { ...column, id: toolsColumnId, header: ToolsHeader }
          : column,
      ),
    [displayedColumns, toolsColumnId],
  );
  const tools = hasTools ? (
    <span className="inline-flex items-center gap-1">
      {filters && <FilterBar {...filters} />}
      {settingsProps && <TableSettings {...settingsProps} />}
    </span>
  ) : null;
  const headerContext = tools && toolsColumn ? { tools, originalHeader: toolsColumn.header } : null;

  return (
    <div className={cn('flex flex-col gap-4', className)} data-testid={testId}>
      {hasTools && !toolsColumn && <div className="flex justify-end">{tools}</div>}

      {/* oxlint-disable-next-line react/jsx-no-constructed-context-values -- 按鈕元素帶著篩選值與欄位設定，每次渲染本來就是新的，表頭需要跟著更新 */}
      <ToolsHeaderContext value={headerContext}>
        <Table
          {...tableProps}
          columns={headerContext ? columnsWithTools : displayedColumns}
          emptyTitle={emptyTitle ?? t('common.empty')}
        />
      </ToolsHeaderContext>

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

interface ToolsHeaderValue {
  /** 篩選與欄位設定按鈕；在 `RichTable` 裡組好，泛型（篩選值型別）不必穿過 context。 */
  tools: ReactNode;
  /** 被取代之前的表頭（字串或 render 函式）；context 帶不了列資料的泛型，取用時再還原型別。 */
  originalHeader: unknown;
}

const ToolsHeaderContext = createContext<ToolsHeaderValue | null>(null);

/**
 * 放篩選與欄位設定按鈕的表頭：原本的內容後面接按鈕。
 * 必須是模組層級的穩定函式：TanStack 的 `flexRender` 把函式表頭當成元件渲染，
 * 每次產生新的函式會讓按鈕重新掛載，面板在值改變（網址更新、欄位設定寫入）時就會被關掉。
 * 按鈕因此改由 context 傳入。
 */
function ToolsHeader<TData>(context: HeaderContext<TData, unknown>) {
  const value = useContext(ToolsHeaderContext);
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-2">
      {flexRender(value.originalHeader as ColumnDef<TData, unknown>['header'], context)}
      {value.tools}
    </span>
  );
}
