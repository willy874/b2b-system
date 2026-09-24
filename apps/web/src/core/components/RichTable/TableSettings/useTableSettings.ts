import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

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

interface UseTableSettingsResult<TData> {
  /** 套用順序與顯示設定後，實際交給表格的欄位。 */
  columns: Array<ColumnDef<TData, unknown>>;
  /** 沒有 `config` 時為 `undefined`（不顯示齒輪按鈕）。 */
  settingsProps: TableSettingsProps | undefined;
}

/**
 * 把欄位設定套到表格欄位上。
 * 只有「有 id、表頭是非空字串、且不是 `fixedColumnId`」的欄位可以設定；
 * 其他欄位（操作欄、純圖示欄）保留在原本的位置，永遠顯示。
 */
export function useTableSettings<TData>(
  columns: Array<ColumnDef<TData, unknown>>,
  config: TableSettingsConfig | undefined,
  fixedColumnId: string,
): UseTableSettingsResult<TData> {
  const configurable = useMemo(
    () =>
      columns.flatMap((column): TableSettingsColumn[] =>
        column.id &&
        column.id !== fixedColumnId &&
        typeof column.header === 'string' &&
        column.header
          ? [{ id: column.id, label: column.header }]
          : [],
      ),
    [columns, fixedColumnId],
  );
  const { value, settingsProps } = useTableColumnSettings(
    config?.tableId,
    configurable,
    config?.defaultHidden,
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

  return { columns: displayed, settingsProps };
}
