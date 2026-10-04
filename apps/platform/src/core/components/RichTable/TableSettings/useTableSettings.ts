import type { RowData } from '@tanstack/react-table';
import { useMemo } from 'react';

import type { TableColumnDef } from '@/components/Table';
import type { TableColumnSettings } from '@/core/store';

import type { TableSettingsColumn, TableSettingsProps } from './TableSettings';
import { useTableColumnSettings } from './useTableColumnSettings';

export interface TableSettingsConfig {
  /**
   * 設定依這個 id 存在 localStorage；同一張表在各頁面要用同一個值。
   * 在 `core/preference` 登記同一個 id（`registerPreferenceTable`），偏好頁才能列出、調整它。
   */
  tableId: string;
  /** 沒有存過設定時預設隱藏的欄位；沒給時沿用 `core/preference` 登記的值。 */
  defaultHidden?: readonly string[];
}

interface UseTableSettingsResult<TData extends RowData> {
  /** 套用順序與顯示設定後，實際交給表格的欄位。 */
  columns: Array<TableColumnDef<TData>>;
  /** 目前生效的設定；沒有 `config` 時是預設值（操作欄固定在 `end`、表頭不固定）。 */
  value: TableColumnSettings;
  /** 沒有 `config` 時為 `undefined`（不顯示齒輪按鈕）。 */
  settingsProps: TableSettingsProps | undefined;
}

/**
 * 把欄位設定套到表格欄位上。
 * 只有「有 id、表頭是非空字串（或有 `meta.settingsLabel`）、且不是 `fixedColumnId`」的欄位可以設定；
 * 其他欄位（操作欄、純圖示欄）保留在原本的位置，永遠顯示。
 */
export function useTableSettings<TData extends RowData>(
  columns: Array<TableColumnDef<TData>>,
  config: TableSettingsConfig | undefined,
  fixedColumnId: string,
): UseTableSettingsResult<TData> {
  const configurable = useMemo(
    () =>
      columns.flatMap((column): TableSettingsColumn[] => {
        const label = settingsLabelOf(column);
        return column.id && column.id !== fixedColumnId && label ? [{ id: column.id, label }] : [];
      }),
    [columns, fixedColumnId],
  );
  // 固定欄位（操作欄）不列入順序，但可以設定固定在哪一側
  const fixed = useMemo(
    () =>
      columns.flatMap((column): TableSettingsColumn[] =>
        column.id === fixedColumnId
          ? [
              {
                id: column.id,
                label: typeof column.header === 'string' ? column.header : column.id,
              },
            ]
          : [],
      ),
    [columns, fixedColumnId],
  );
  const { value, settingsProps } = useTableColumnSettings(
    config?.tableId,
    configurable,
    config?.defaultHidden,
    fixed,
  );

  const displayed = useMemo(() => {
    if (!settingsProps) return columns;
    const byId = new Map(columns.map((column) => [column.id, column]));
    const configurableIds = new Set(configurable.map((column) => column.id));
    let next = 0;
    // 可設定的欄位依設定的順序依序填回原本可設定欄位的位置，固定欄位原地不動
    return columns.flatMap((column) => {
      if (!column.id || !configurableIds.has(column.id)) return [column];
      const id = value.order[next];
      next += 1;
      const target = id === undefined ? undefined : byId.get(id);
      return target && id !== undefined && !value.hidden.includes(id) ? [target] : [];
    });
  }, [columns, configurable, settingsProps, value]);

  return { columns: displayed, value, settingsProps };
}

/**
 * 欄位設定裡的名稱：字串表頭，或非字串表頭（勾選框、圖示）的 `meta.settingsLabel`。
 * 宣告了 `settingsLabel` 就算可設定；名稱是空的（語系還沒載入）時退回欄位 id，欄位不會因此脫離設定。
 */
function settingsLabelOf<TData extends RowData>(column: TableColumnDef<TData>): string | undefined {
  if (typeof column.header === 'string' && column.header) return column.header;
  if (column.meta && 'settingsLabel' in column.meta) return column.meta.settingsLabel || column.id;
  return undefined;
}
