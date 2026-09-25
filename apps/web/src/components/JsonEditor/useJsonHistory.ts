import { useCallback, useMemo, useState } from 'react';

export interface JsonHistory {
  /** 送出新的一版。`coalesce` 相同的連續變更併成一步（例如文字模式的每次按鍵）。 */
  commit: (next: unknown, options?: { coalesce?: string }) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface HistoryState {
  past: unknown[];
  present: unknown;
  future: unknown[];
  coalesce: string | undefined;
}

/** 最多保留幾步；每一步只是根的參考（未改到的子樹共用），但仍要設上限。 */
const MAX_STEPS = 100;

/**
 * 撤銷／重做：保存每一版的根（jsonEdit 的操作都是不可變的）。
 * 外部把 `value` 換成不是這裡送出的值時（受控元件被重設），歷史清空。
 */
export function useJsonHistory(value: unknown, onChange: (next: unknown) => void): JsonHistory {
  const [stored, setStored] = useState<HistoryState>({
    past: [],
    present: value,
    future: [],
    coalesce: undefined,
  });
  const state = useMemo<HistoryState>(
    () =>
      stored.present === value
        ? stored
        : { past: [], present: value, future: [], coalesce: undefined },
    [stored, value],
  );

  const commit = useCallback(
    (next: unknown, options?: { coalesce?: string }) => {
      if (next === state.present) return;
      const coalesce = options?.coalesce;
      const merge = coalesce !== undefined && coalesce === state.coalesce;
      setStored({
        past: merge ? state.past : [...state.past, state.present].slice(-MAX_STEPS),
        present: next,
        future: [],
        coalesce,
      });
      onChange(next);
    },
    [state, onChange],
  );

  const undo = useCallback(() => {
    const previous = state.past.at(-1);
    if (state.past.length === 0) return;
    setStored({
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
      coalesce: undefined,
    });
    onChange(previous);
  }, [state, onChange]);

  const redo = useCallback(() => {
    const [next, ...rest] = state.future;
    if (state.future.length === 0) return;
    setStored({
      past: [...state.past, state.present],
      present: next,
      future: rest,
      coalesce: undefined,
    });
    onChange(next);
  }, [state, onChange]);

  return {
    commit,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
