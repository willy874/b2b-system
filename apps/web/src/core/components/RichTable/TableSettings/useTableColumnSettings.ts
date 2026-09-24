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

/**
 * 讀寫一張表的欄位設定，並組出 `TableSettings` 需要的 props。
 * 列表（`RichTable`）與偏好頁共用：兩邊改的是同一份設定。
 * `defaultHidden` 沒給時沿用 `core/preference` 登記的值。
 */
export function useTableColumnSettings(
  tableId: string | undefined,
  columns: TableSettingsColumn[],
  defaultHidden?: readonly string[],
): UseTableColumnSettingsResult {
  const hiddenByDefault =
    defaultHidden ?? (tableId ? getPreferenceTable(tableId)?.defaultHidden : undefined);
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);

  useEffect(() => (tableId ? syncTableColumnSettings() : undefined), [tableId]);

  const setTableSettings = useTableColumnSettingsStore((state) => state.setTableSettings);
  const resetTableSettings = useTableColumnSettingsStore((state) => state.resetTableSettings);
  const stored = useTableColumnSettingsStore((state) =>
    tableId ? state.settings[tableId] : undefined,
  );

  const value = useMemo(
    () => resolveColumnSettings(columnIds, stored, hiddenByDefault),
    [columnIds, stored, hiddenByDefault],
  );
  const defaultValue = useMemo(
    () => resolveColumnSettings(columnIds, undefined, hiddenByDefault),
    [columnIds, hiddenByDefault],
  );

  const settingsProps = useMemo(
    () =>
      tableId
        ? {
            columns,
            value,
            defaultValue,
            onChange: (next: TableColumnSettings) => setTableSettings(tableId, next),
            onReset: () => resetTableSettings(tableId),
          }
        : undefined,
    [columns, defaultValue, resetTableSettings, setTableSettings, tableId, value],
  );

  return { value, settingsProps };
}
