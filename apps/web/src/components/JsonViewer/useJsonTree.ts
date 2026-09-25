import { useCallback, useMemo, useState } from 'react';

import { toJsonLines } from './jsonLines';
import type { JsonLine } from './jsonLines';

interface TreeState {
  resetKey: unknown;
  /** 與 `defaultExpandDepth` 相反的節點（路徑字串）。 */
  toggled: ReadonlySet<string>;
}

const EMPTY_PATHS: ReadonlySet<string> = new Set();

export interface UseJsonTreeOptions {
  /** 這個深度（含）以下的物件／陣列一開始是收合的；根節點深度為 0。 */
  defaultExpandDepth: number;
  /** 這個值改變時，收合狀態回到預設（JsonViewer 傳 `value`）。 */
  resetKey: unknown;
}

export interface JsonTree {
  lines: JsonLine[];
  toggle: (path: string) => void;
}

/** JsonViewer 的收合狀態 ＋ 攤平成行。 */
export function useJsonTree(
  value: unknown,
  { defaultExpandDepth, resetKey }: UseJsonTreeOptions,
): JsonTree {
  const [stored, setStored] = useState<TreeState>({ resetKey, toggled: EMPTY_PATHS });
  const toggled = stored.resetKey === resetKey ? stored.toggled : EMPTY_PATHS;

  const toggle = useCallback(
    (path: string) =>
      setStored((previous) => {
        const next = new Set(previous.resetKey === resetKey ? previous.toggled : EMPTY_PATHS);
        if (!next.delete(path)) next.add(path);
        return { resetKey, toggled: next };
      }),
    [resetKey],
  );

  const lines = useMemo(
    () => toJsonLines(value, (path, depth) => depth >= defaultExpandDepth !== toggled.has(path)),
    [value, toggled, defaultExpandDepth],
  );

  return { lines, toggle };
}
