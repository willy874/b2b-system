import { useCallback, useEffect, useRef, useState } from 'react';

import type { TreeEditorValue } from './treeGraph';

/** 復原紀錄最多保留幾步；更早的丟掉，避免長時間編輯時記憶體一直長。 */
export const TREE_HISTORY_LIMIT = 100;

interface HistoryStacks<TData> {
  past: TreeEditorValue<TData>[];
  future: TreeEditorValue<TData>[];
}

/**
 * 以「整份快照」記錄的復原／重做。快照之間共用沒改到的節點物件，成本只有陣列本身。
 *
 * 每一次 `commit` 是一步：拖曳只在放開時 commit，所以拖一段路復原一次就回去。
 * 傳入的 `value` 不是最後一次 commit／復原出去的那個參考時（呼叫端換了一份資料），紀錄清空——
 * 與 `JsonEditor` 相同（docs/architecture/frontend/07-ui-system.md §3.12）。
 */
export function useTreeHistory<TData>(
  value: TreeEditorValue<TData>,
  setValue: (next: TreeEditorValue<TData>) => void,
) {
  const [stacks, setStacks] = useState<HistoryStacks<TData>>({ past: [], future: [] });
  const emitted = useRef(value);

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setStacks({ past: [], future: [] });
  }, [value]);

  const emit = useCallback(
    (next: TreeEditorValue<TData>) => {
      emitted.current = next;
      setValue(next);
    },
    [setValue],
  );

  const commit = useCallback(
    (next: TreeEditorValue<TData>) => {
      const current = emitted.current;
      if (next === current) return;
      setStacks((prev) => ({
        past: [...prev.past, current].slice(-TREE_HISTORY_LIMIT),
        future: [],
      }));
      emit(next);
    },
    [emit],
  );

  const undo = useCallback(() => {
    const previous = stacks.past.at(-1);
    if (!previous) return;
    setStacks({ past: stacks.past.slice(0, -1), future: [emitted.current, ...stacks.future] });
    emit(previous);
  }, [emit, stacks]);

  const redo = useCallback(() => {
    const [next, ...rest] = stacks.future;
    if (!next) return;
    setStacks({ past: [...stacks.past, emitted.current], future: rest });
    emit(next);
  }, [emit, stacks]);

  return {
    commit,
    undo,
    redo,
    canUndo: stacks.past.length > 0,
    canRedo: stacks.future.length > 0,
  };
}
