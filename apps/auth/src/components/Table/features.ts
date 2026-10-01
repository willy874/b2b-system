import {
  columnPinningFeature,
  columnSizingFeature,
  metaHelper,
  rowPinningFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/react-table';
import type { CellContext, ColumnDef, HeaderContext, RowData } from '@tanstack/react-table';

/** 欄位定義的 `meta`：`Table` 與 `RichTable` 會讀這些欄位。 */
export interface TableColumnMeta {
  /**
   * 表頭不是字串（例如勾選框）的欄位在欄位設定裡顯示的名稱；
   * 有它的欄位才能被設定（排序、隱藏、固定）。
   */
  settingsLabel?: string;
  /**
   * 允許這一欄的內容換行（預設不換行，寬度不夠時整張表水平捲動）。
   * 通常再給 `size`，否則自動版面仍可能把它擠得很窄。
   */
  wrap?: boolean;
}

/**
 * `Table` 用到的 TanStack Table 功能（v9 起要明確登記，沒登記的功能不會打包）。
 * 排序、分頁都交給伺服器，所以不登記排序／分頁的 row model：
 * `rowSortingFeature` 只為了欄位定義的 `enableSorting`，`columnSizingFeature` 只為了 `size`。
 * `columnMeta` 是只有型別的欄位，讓 `meta` 有型別而不必全域擴充 `ColumnMeta`。
 */
export const TABLE_FEATURES = tableFeatures({
  columnPinningFeature,
  columnSizingFeature,
  rowPinningFeature,
  rowSelectionFeature,
  rowSortingFeature,
  columnMeta: metaHelper<TableColumnMeta>(),
});

export type TableFeatureSet = typeof TABLE_FEATURES;

/** 交給 `Table` / `RichTable` 的欄位定義。 */
export type TableColumnDef<TData extends RowData, TValue = unknown> = ColumnDef<
  TableFeatureSet,
  TData,
  TValue
>;

/** 欄位 `cell` 函式收到的參數。 */
export type TableCellContext<TData extends RowData, TValue = unknown> = CellContext<
  TableFeatureSet,
  TData,
  TValue
>;

/** 欄位 `header` 函式收到的參數。 */
export type TableHeaderContext<TData extends RowData, TValue = unknown> = HeaderContext<
  TableFeatureSet,
  TData,
  TValue
>;
