import { useCallback, useMemo, useState } from 'react';

import { parsePath, toJsonLines } from './jsonLines';
import type { JsonLine } from './jsonLines';

/** 收合的基準：`default` 依 `defaultExpandDepth`；`all` 全部展開；`none` 只留根節點展開。 */
type ExpandBase = 'default' | 'all' | 'none';

interface TreeState {
  resetKey: unknown;
  base: ExpandBase;
  /** 與基準相反的節點（路徑字串）。 */
  toggled: ReadonlySet<string>;
}

const EMPTY_PATHS: ReadonlySet<string> = new Set();

const initialState = (resetKey: unknown): TreeState => ({
  resetKey,
  base: 'default',
  toggled: EMPTY_PATHS,
});

export interface UseJsonTreeOptions {
  /** 這個深度（含）以下的物件／陣列一開始是收合的；根節點深度為 0。 */
  defaultExpandDepth: number;
  /** 值改變時收合狀態回到預設（JsonViewer 傳 `value`；JsonEditor 編輯時要保留狀態，不傳）。 */
  resetKey?: unknown;
}

export interface JsonTree {
  lines: JsonLine[];
  toggle: (path: string) => void;
  /** 確保某個節點是展開的（例如新增子項之後）。 */
  expand: (path: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

/** JsonViewer／JsonEditor 共用：收合狀態 ＋ 攤平成行。 */
export function useJsonTree(
  value: unknown,
  { defaultExpandDepth, resetKey }: UseJsonTreeOptions,
): JsonTree {
  const [stored, setStored] = useState(() => initialState(resetKey));
  const state = useMemo(
    () => (stored.resetKey === resetKey ? stored : initialState(resetKey)),
    [stored, resetKey],
  );

  const isCollapsedBy = useCallback(
    ({ base, toggled }: TreeState, path: string, depth: number) => {
      const byBase =
        base === 'all' ? false : base === 'none' ? depth >= 1 : depth >= defaultExpandDepth;
      return byBase !== toggled.has(path);
    },
    [defaultExpandDepth],
  );

  const update = useCallback(
    (next: (current: TreeState) => TreeState) =>
      setStored((previous) =>
        next(previous.resetKey === resetKey ? previous : initialState(resetKey)),
      ),
    [resetKey],
  );

  const toggle = useCallback(
    (path: string) =>
      update((current) => {
        const toggled = new Set(current.toggled);
        if (!toggled.delete(path)) toggled.add(path);
        return { ...current, toggled };
      }),
    [update],
  );

  const expand = useCallback(
    (path: string) =>
      update((current) => {
        if (!isCollapsedBy(current, path, parsePath(path).length)) return current;
        const toggled = new Set(current.toggled);
        if (!toggled.delete(path)) toggled.add(path);
        return { ...current, toggled };
      }),
    [update, isCollapsedBy],
  );

  const expandAll = useCallback(
    () => update((current) => ({ ...current, base: 'all', toggled: EMPTY_PATHS })),
    [update],
  );
  const collapseAll = useCallback(
    () => update((current) => ({ ...current, base: 'none', toggled: EMPTY_PATHS })),
    [update],
  );

  const lines = useMemo(
    () => toJsonLines(value, (path, depth) => isCollapsedBy(state, path, depth)),
    [value, state, isCollapsedBy],
  );

  return { lines, toggle, expand, expandAll, collapseAll };
}
