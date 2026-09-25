import type { RowPinningState } from '@tanstack/react-table';
import { useMemo } from 'react';

import { useTableColumnSettingsStore } from '@/core/store';
import type { PinnedRow, RowPinSide } from '@/core/store';

const EMPTY_PINNED: PinnedRow[] = [];
const NO_ROW_PINNING: RowPinningState = {};

interface UseRowPinningOptions<TData> {
  /** 釘選依這個 id 存進偏好（與欄位設定同一個 `tableId`）；沒有時不提供釘選。 */
  tableId: string | undefined;
  enabled: boolean;
  data: TData[];
  getRowId: ((row: TData) => string) | undefined;
}

/**
 * 資料列釘選：釘選欄（`createPinColumn`）的每一列有釘選選單，釘選的列貼在頂端或底端，換頁、排序都不會移動。
 * 伺服器分頁時，其他頁的釘選列以釘選當下的資料併進 `data`；回到該頁時改用最新的那一筆。
 * 釘選記在偏好（`useTableColumnSettingsStore().pinnedRows`），重新整理、換分頁都還在。
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
  const pinRow = useTableColumnSettingsStore((state) => state.pinRow);
  const unpinRow = useTableColumnSettingsStore((state) => state.unpinRow);

  const merged = useMemo(() => {
    if (!active || entries.length === 0) return { data, rowPinning: NO_ROW_PINNING };
    const onPage = new Set(data.map((row) => getRowId(row)));
    const offPage = entries
      .filter((entry) => !onPage.has(entry.id))
      .map((entry) => entry.row as TData);
    const idsOf = (side: RowPinSide) =>
      entries.filter((entry) => entry.side === side).map((entry) => entry.id);
    return {
      data: [...data, ...offPage],
      rowPinning: { top: idsOf('top'), bottom: idsOf('bottom') },
    };
  }, [active, data, entries, getRowId]);

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
