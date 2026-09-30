import { useCallback, useMemo, useState } from 'react';

export type SelectionMode = 'replace' | 'add' | 'toggle';

/**
 * 檔案的多選狀態（仿作業系統的檔案總管）：
 * - 點擊：只選這一個；Ctrl / ⌘ 點擊：切換這一個；Shift 點擊：從錨點選到這一個
 * - 框選：`replace`（一般）或 `add`（按著 Shift / Ctrl / ⌘）
 *
 * 選取以 id 記錄，並以目前的 `ids` 過濾：資料重抓後（別人刪了、換頁、篩選）不在畫面上的自動移出，
 * 批次操作不會送出看不到的項目（docs/architecture/frontend/12-file-manager.md §7）。
 */
export function useFileSelection(ids: readonly string[]) {
  const [raw, setRaw] = useState<ReadonlySet<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string>();

  const idSet = useMemo(() => new Set(ids), [ids]);
  const selected = useMemo(() => {
    const visible = new Set<string>();
    for (const id of raw) if (idSet.has(id)) visible.add(id);
    return visible as ReadonlySet<string>;
  }, [idSet, raw]);

  const click = useCallback(
    (id: string, modifiers: { shift?: boolean; toggle?: boolean } = {}) => {
      if (modifiers.shift && anchor && idSet.has(anchor)) {
        const from = ids.indexOf(anchor);
        const to = ids.indexOf(id);
        const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
        setRaw((current) => new Set([...(modifiers.toggle ? current : []), ...range]));
        return;
      }
      setAnchor(id);
      if (modifiers.toggle) {
        setRaw((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        return;
      }
      setRaw(new Set([id]));
    },
    [anchor, idSet, ids],
  );

  /** 框選：`base` 是開始拖曳時的選取（`add` 模式在它上面疊加）。 */
  const apply = useCallback(
    (next: readonly string[], mode: SelectionMode, base: ReadonlySet<string> = new Set()) => {
      if (mode === 'replace') {
        setRaw(new Set(next));
      } else if (mode === 'add') {
        setRaw(new Set([...base, ...next]));
      } else {
        const toggled = new Set(base);
        for (const id of next) {
          if (base.has(id)) toggled.delete(id);
          else toggled.add(id);
        }
        setRaw(toggled);
      }
    },
    [],
  );

  return {
    selected,
    anchor,
    click,
    apply,
    selectAll: useCallback(() => setRaw(new Set(ids)), [ids]),
    clear: useCallback(() => setRaw(new Set()), []),
    isSelected: useCallback((id: string) => selected.has(id), [selected]),
  };
}

export type FileSelection = ReturnType<typeof useFileSelection>;
