import { useEffect, useMemo } from 'react';

import { getPreferenceTable } from '@/core/preference';
import {
  resolveColumnSettings,
  syncTableColumnSettings,
  useTableColumnSettingsStore,
} from '@/core/store';
import type { TableColumnSettings } from '@/core/store';

import type { TableSettingsColumn, TableSettingsProps } from './TableSettings';

interface UseTableColumnSettingsResult {
  /** 已與 `columns` 合併過的設定；沒有 `tableId` 時是欄位原本的順序、全部顯示。 */
  value: TableColumnSettings;
  /** 沒有 `tableId` 時為 `undefined`（不顯示齒輪按鈕）。 */
  settingsProps: TableSettingsProps | undefined;
}

const NO_FIXED_COLUMNS: TableSettingsColumn[] = [];

/**
 * 讀寫一張表的欄位設定，並組出 `TableSettings` 需要的 props。
 * 列表（`RichTable`）與偏好頁共用：兩邊改的是同一份設定。
 * `defaultHidden` 沒給時沿用 `core/preference` 登記的值。
 * `fixedColumns` 是不列入順序、但可以固定的欄位（操作欄）。
 */
export function useTableColumnSettings(
  tableId: string | undefined,
  columns: TableSettingsColumn[],
  defaultHidden?: readonly string[],
  fixedColumns: TableSettingsColumn[] = NO_FIXED_COLUMNS,
): UseTableColumnSettingsResult {
  const hiddenByDefault =
    defaultHidden ?? (tableId ? getPreferenceTable(tableId)?.defaultHidden : undefined);
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);
  const fixedIds = useMemo(() => fixedColumns.map((column) => column.id), [fixedColumns]);

  useEffect(() => (tableId ? syncTableColumnSettings() : undefined), [tableId]);

  const setTableSettings = useTableColumnSettingsStore((state) => state.setTableSettings);
  const resetTableSettings = useTableColumnSettingsStore((state) => state.resetTableSettings);
  const stored = useTableColumnSettingsStore((state) =>
    tableId ? state.settings[tableId] : undefined,
  );

  const value = useMemo(
    () => resolveColumnSettings(columnIds, stored, hiddenByDefault, fixedIds),
    [columnIds, stored, hiddenByDefault, fixedIds],
  );
  const defaultValue = useMemo(
    () => resolveColumnSettings(columnIds, undefined, hiddenByDefault, fixedIds),
    [columnIds, hiddenByDefault, fixedIds],
  );

  const settingsProps = useMemo(
    () =>
      tableId
        ? {
            columns,
            fixedColumns,
            value,
            defaultValue,
            onChange: (next: TableColumnSettings) => setTableSettings(tableId, next),
            onReset: () => resetTableSettings(tableId),
          }
        : undefined,
    [columns, defaultValue, fixedColumns, resetTableSettings, setTableSettings, tableId, value],
  );

  return { value, settingsProps };
}
