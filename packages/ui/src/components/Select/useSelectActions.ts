import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

import { useLatestRef } from '../useLatestRef';
import { useListNavigation } from '../VirtualList';
import { checkState, optionText, orderByOptions, toggleValues } from './selectModel';
import type { SelectModel } from './useSelectModel';

export interface UseSelectActionsOptions {
  /** 列表的捲動容器；掛上時（開啟後）定位作用列 */
  scrollElement: HTMLElement | null;
  /** 把某一列捲進可視範圍（`useVirtualRows`） */
  scrollToIndex: (index: number) => void;
  /** 搜尋框：焦點在它上面時，編輯文字的按鍵留給它 */
  inputRef: RefObject<HTMLInputElement | null>;
}

export interface SelectActions {
  /** 目前的作用列；`-1` 表示沒有 */
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** 點一列：勾選／取消、選取並關閉、或展開收合群組（依單選、多選、群組） */
  pick: (rowIndex: number) => void;
  /** 展開或收合群組列；`force` 指定結果 */
  toggleExpand: (rowIndex: number, force?: boolean) => void;
  /** 列表與搜尋框共用的鍵盤操作 */
  onListKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Select 的操作：作用列（鍵盤導覽、開啟與換關鍵字時的定位）、勾選與展開、鍵盤。
 * 給列元件的 callback 都是固定參考（最新的資料從 ref 讀），列元件的 `memo` 才有效。
 */
export function useSelectActions<T extends string>(
  model: SelectModel<T>,
  { scrollElement, scrollToIndex, inputRef }: UseSelectActionsOptions,
): SelectActions {
  const {
    rows,
    selected,
    index,
    viewIndex,
    expanded,
    isMultiple,
    selectableGroups,
    valueOrder,
    searchable,
    shownExpanded,
    open,
    setOpen,
    search,
    deferredSearch,
    setSelected,
    setExpanded,
    isRowDisabled,
  } = model;

  const navigation = useListNavigation({
    count: rows.length,
    // selectableGroups 時停用的群組列仍可停留，才能用 → 展開、走到可選的子孫
    isDisabled: (rowIndex) => {
      const row = rows[rowIndex];
      return selectableGroups && row?.kind === 'option' && row.isGroup ? false : isRowDisabled(row);
    },
    // 有搜尋框時打字是輸入關鍵字，不做 typeahead
    getLabel: searchable
      ? undefined
      : (rowIndex) => {
          const row = rows[rowIndex];
          return row?.kind === 'option' ? optionText(row.option) : undefined;
        },
    onNavigate: scrollToIndex,
  });
  const { activeIndex, setActiveIndex, navigateTo, firstEnabled } = navigation;

  // ── 動作（全部是固定參考，列元件的 memo 才有效） ──────────
  const latestRef = useLatestRef({
    rows,
    selected,
    index,
    viewIndex,
    expanded,
    isMultiple,
    selectableGroups,
    valueOrder,
  });

  // 開啟後（捲動容器掛上時）作用列落在第一個已選項目，並捲到它。
  // 只在開啟時定位一次（rows / selected 從 ref 讀）：之後勾選、載入更多都不能動捲動位置。
  useEffect(() => {
    if (!open || !scrollElement) return;
    const { rows: list, selected: current } = latestRef.current;
    const keys = new Map(list.map((row, rowIndex) => [row.key, rowIndex]));
    const selectedIndex = current.reduce<number>(
      (found, value) => (found >= 0 ? found : (keys.get(value) ?? -1)),
      -1,
    );
    navigateTo(selectedIndex >= 0 ? selectedIndex : firstEnabled());
  }, [open, scrollElement, latestRef, navigateTo, firstEnabled]);

  // 關鍵字改變：作用列回到第一個符合的選項，捲回頂端
  const lastSearch = useRef(deferredSearch);
  useEffect(() => {
    if (lastSearch.current === deferredSearch) return;
    lastSearch.current = deferredSearch;
    if (!open || !scrollElement) return;
    scrollToIndex(0);
    setActiveIndex(firstEnabled());
  }, [deferredSearch, open, scrollElement, firstEnabled, scrollToIndex, setActiveIndex]);

  const commit = useCallback(
    (next: readonly T[]) => {
      const { selected: current, index: tree, valueOrder: order } = latestRef.current;
      if (next === current) return;
      setSelected(order === 'options' ? orderByOptions(next, tree.leafOrder) : next);
    },
    [latestRef, setSelected],
  );

  const toggleExpand = useCallback(
    (rowIndex: number, force?: boolean) => {
      const { rows: list, expanded: current } = latestRef.current;
      const row = list[rowIndex];
      if (row?.kind !== 'option' || !row.isGroup) return;
      const isOpen = current.includes(row.key);
      const nextOpen = force ?? !isOpen;
      if (nextOpen === isOpen) return;
      setExpanded(nextOpen ? [...current, row.key] : current.filter((value) => value !== row.key));
    },
    [latestRef, setExpanded],
  );

  const toggleAll = useCallback(() => {
    const { selected: current, viewIndex: tree } = latestRef.current;
    const select = checkState(tree.enabledLeaves, new Set(current)) !== 'checked';
    commit(toggleValues(current, tree.enabledLeaves, select));
  }, [commit, latestRef]);

  const pick = useCallback(
    (rowIndex: number) => {
      const {
        rows: list,
        selected: current,
        viewIndex: tree,
        isMultiple: multiple,
        selectableGroups: groupSelectable,
      } = latestRef.current;
      const row = list[rowIndex];
      if (!row) return;
      setActiveIndex(rowIndex);
      if (row.kind === 'all') {
        toggleAll();
        return;
      }
      if (row.isGroup && !groupSelectable) {
        if (!multiple) {
          toggleExpand(rowIndex);
          return;
        }
        const leaves = tree.groupLeaves.get(row.key) ?? [];
        const select = checkState(leaves, new Set(current)) !== 'checked';
        commit(toggleValues(current, leaves, select));
        return;
      }
      if (multiple) {
        commit(toggleValues(current, [row.key], !current.includes(row.key)));
        return;
      }
      if (current[0] !== row.key) commit([row.key]);
      setOpen(false);
    },
    [commit, latestRef, setActiveIndex, setOpen, toggleAll, toggleExpand],
  );

  /** 列表與搜尋框共用；在搜尋框時，編輯文字用的按鍵（字元、空白、Home/End、有字時的 ←/→）留給輸入框。 */
  const onListKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.currentTarget === inputRef.current) {
      const isTyping = event.key.length === 1 && !event.ctrlKey && !event.metaKey;
      const isCaret =
        event.key === 'Home' ||
        event.key === 'End' ||
        ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && search !== '');
      const isTextShortcut = event.key === 'a' && (event.ctrlKey || event.metaKey);
      if (isTyping || isCaret || isTextShortcut) return;
    }
    if (navigation.handleKeyDown(event)) return;
    const row = rows[activeIndex];
    switch (event.key) {
      case 'Enter':
      case ' ':
        if (activeIndex < 0 || isRowDisabled(row)) return;
        event.preventDefault();
        pick(activeIndex);
        return;
      case 'ArrowRight':
        if (row?.kind !== 'option' || !row.isGroup) return;
        event.preventDefault();
        if (!shownExpanded.has(row.key)) toggleExpand(activeIndex, true);
        else if (rows[activeIndex + 1]?.parentIndex === activeIndex) navigateTo(activeIndex + 1);
        return;
      case 'ArrowLeft':
        if (!row) return;
        event.preventDefault();
        if (row.kind === 'option' && row.isGroup && shownExpanded.has(row.key)) {
          toggleExpand(activeIndex, false);
        } else if (row.parentIndex >= 0) {
          navigateTo(row.parentIndex);
        }
        return;
      case 'a':
        if (isMultiple && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          toggleAll();
        }
        return;
      default:
    }
  };

  return { activeIndex, setActiveIndex, pick, toggleExpand, onListKeyDown };
}
