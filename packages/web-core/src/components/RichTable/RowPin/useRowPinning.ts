import type { RowPinningState } from '@tanstack/react-table';
import { useMemo } from 'react';

import { useTableColumnSettingsStore } from '../../../store';
import type { PinnedRow, RowPinSide } from '../../../store';

const EMPTY_PINNED: PinnedRow[] = [];
const EMPTY_ROW_DATA: Readonly<Record<string, unknown>> = {};
const NO_ROW_PINNING: RowPinningState = { top: [], bottom: [] };

interface UseRowPinningOptions<TData> {
  /** 釘選依這個 id 存進偏好（與欄位設定同一個 `tableId`）；沒有時不提供釘選。 */
  tableId: string | undefined;
  enabled: boolean;
  data: TData[];
  getRowId: ((row: TData) => string) | undefined;
}

/**
 * 資料列釘選：釘選欄（`createPinColumn`）的每一列有釘選選單，釘選的列貼在頂端或底端，換頁、排序都不會移動。
 * 伺服器分頁時，其他頁的釘選列以釘選當下的資料（只在記憶體的 `pinnedRowData`）併進 `data`；回到該頁時改用最新的那一筆。
 * 釘選的 id 與側邊記在偏好（`useTableColumnSettingsStore().pinnedRows`），重新整理、換分頁都還在；
 * 資料不落地，重新整理或 session 結束後，不在目前這一頁的釘選列要回到它所在的頁才會顯示。
 */
export function useRowPinning<TData>({
  tableId,
  enabled,
  data,
  getRowId,
}: UseRowPinningOptions<TData>) {
  const active = enabled && tableId !== undefined && getRowId !== undefined;

  const entries = useTableColumnSettingsStore((state) =>
    tableId ? (state.pinnedRows[tableId] ?? EMPTY_PINNED) : EMPTY_PINNED,
  );
  const rowData = useTableColumnSettingsStore((state) =>
    tableId ? (state.pinnedRowData[tableId] ?? EMPTY_ROW_DATA) : EMPTY_ROW_DATA,
  );
  const pinRow = useTableColumnSettingsStore((state) => state.pinRow);
  const unpinRow = useTableColumnSettingsStore((state) => state.unpinRow);

  const merged = useMemo(() => {
    if (!active || entries.length === 0) return { data, rowPinning: NO_ROW_PINNING };
    const onPage = new Set(data.map((row) => getRowId(row)));
    // 不在這一頁、記憶體裡也沒有資料的釘選列（重新整理過、session 換過）先不顯示
    const shown = entries.filter((entry) => onPage.has(entry.id) || entry.id in rowData);
    const offPage = shown
      .filter((entry) => !onPage.has(entry.id))
      .map((entry) => rowData[entry.id] as TData);
    const idsOf = (side: RowPinSide) =>
      shown.filter((entry) => entry.side === side).map((entry) => entry.id);
    return {
      data: [...data, ...offPage],
      rowPinning: { top: idsOf('top'), bottom: idsOf('bottom') },
    };
  }, [active, data, entries, getRowId, rowData]);

  const contextValue = useMemo(
    () => ({
      pinned: new Map(entries.map((entry) => [entry.id, entry.side])),
      pin: (id: string, side: RowPinSide, row: unknown) => {
        if (tableId) pinRow(tableId, id, side, row);
      },
      unpin: (id: string) => {
        if (tableId) unpinRow(tableId, id);
      },
    }),
    [entries, pinRow, tableId, unpinRow],
  );

  return {
    /** 可以釘選（有 `tableId` 與 `getRowId`）：呼叫端據此加上釘選欄。 */
    active,
    data: merged.data,
    rowPinning: merged.rowPinning,
    contextValue,
  };
}
