import type { RowSelectionState } from '@tanstack/react-table';
import { useCallback, useMemo, useState } from 'react';

export interface TableSelection<TData> {
  /** 交給 `Table` / `RichTable` 的 `rowSelection`。 */
  rowSelection: RowSelectionState;
  /** 交給 `Table` / `RichTable` 的 `onRowSelectionChange`。 */
  onRowSelectionChange: (next: RowSelectionState) => void;
  /** 依勾選順序排列的 id（跨頁）。 */
  selectedIds: string[];
  /**
   * 勾選的整筆資料（跨頁）：勾選當下的資料，列還在目前的 `data` 裡時換成最新的那一筆。
   * 批次操作（Batch）直接拿這個送出。
   */
  selectedRows: TData[];
  /** 清空選取（例如批次操作完成、或篩選條件改變後）。 */
  clear: () => void;
}

/**
 * 跨頁保留的選取狀態：換頁時其他頁的勾選不會消失，並記住勾選當下的資料，
 * 批次操作時不必再回頭查那幾筆。伺服器分頁的列表用它接 `createSelectColumn`。
 */
export function useTableSelection<TData>(
  data: readonly TData[],
  getRowId: (row: TData) => string,
): TableSelection<TData> {
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, TData>>(new Map());

  const byId = useMemo(() => new Map(data.map((row) => [getRowId(row), row])), [data, getRowId]);

  const rowSelection = useMemo(
    () => Object.fromEntries([...snapshots.keys()].map((id) => [id, true])),
    [snapshots],
  );

  const onRowSelectionChange = useCallback(
    (next: RowSelectionState) => {
      setSnapshots((previous) => {
        // 物件的整數鍵會依數字大小排列，不能拿 next 的鍵順序當勾選順序：
        // 先保留原本還勾著的（原順序），再接上新勾的
        const selectedIds = Object.keys(next).filter((id) => next[id]);
        const kept = [...previous.keys()].filter((id) => next[id]);
        const added = selectedIds.filter((id) => !previous.has(id));
        const updated = new Map<string, TData>();
        for (const id of [...kept, ...added]) {
          const row = byId.get(id) ?? previous.get(id);
          // 不在目前資料、也沒有快照的 id（呼叫端自己塞的）略過：沒有資料就沒辦法做批次操作
          if (row !== undefined) updated.set(id, row);
        }
        return updated;
      });
    },
    [byId],
  );

  const clear = useCallback(() => setSnapshots(new Map()), []);

  return useMemo(() => {
    const selectedIds = [...snapshots.keys()];
    return {
      rowSelection,
      onRowSelectionChange,
      selectedIds,
      selectedRows: selectedIds.map((id) => byId.get(id) ?? (snapshots.get(id) as TData)),
      clear,
    };
  }, [byId, clear, onRowSelectionChange, rowSelection, snapshots]);
}
