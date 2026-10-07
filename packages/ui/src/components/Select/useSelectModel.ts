import { useCallback, useDeferredValue, useMemo, useState } from 'react';

import { useControllableState } from '../useControllableState';
import { useLatestRef } from '../useLatestRef';
import {
  checkState,
  filterOptions,
  flattenRows,
  indexOptions,
  orderByOptions,
  sortOptions,
} from './selectModel';
import type { CheckState, SelectIndex, SelectRow } from './selectModel';
import type { MultipleSelectProps, SelectProps } from './selectProps';

const EMPTY: readonly never[] = [];

function toArray<T>(value: T | readonly T[] | null | undefined): readonly T[] {
  if (value === null || value === undefined) return EMPTY;
  return Array.isArray(value) ? (value as readonly T[]) : [value as T];
}

export interface SelectModel<T extends string> {
  /** 多選時是 props 本身（取 `selectAll`、`maxTagCount` 等多選才有的設定），單選時是 `null` */
  multi: MultipleSelectProps<T> | null;
  isMultiple: boolean;
  /** 單選時群組列也是值（`selectableGroups`） */
  selectableGroups: boolean;
  valueOrder: 'selection' | 'options';
  searchable: boolean;
  /** 選項有 `children`：列表是樹（role="tree"） */
  isTree: boolean;
  /** 完整選項的索引（標籤、排序） */
  index: SelectIndex<T>;
  /** 畫面上看得到的選項的索引（全選、群組的勾選範圍） */
  viewIndex: SelectIndex<T>;
  selected: readonly T[];
  setSelected: (next: readonly T[]) => void;
  expanded: readonly T[];
  setExpanded: (next: readonly T[]) => void;
  /** 實際展開的群組：使用者展開的，加上搜尋時有符合子孫的 */
  shownExpanded: ReadonlySet<T>;
  open: boolean;
  /** 關閉時依 `clearSearchOnClose` 清空搜尋字 */
  setOpen: (next: boolean) => void;
  search: string;
  setSearch: (next: string) => void;
  /** 過濾、分頁用的延後的搜尋字 */
  deferredSearch: string;
  /** 攤平後的列（全選列、選項、展開的子選項） */
  rows: Array<SelectRow<T>>;
  rowState: (row: SelectRow<T>) => CheckState;
  isRowDisabled: (row: SelectRow<T> | undefined) => boolean;
  /** 觸發鈕上依 `valueOrder` 排好的值 */
  displayValues: readonly T[];
}

/**
 * Select 的資料與狀態：排序、索引、搜尋與過濾、已選／展開／開啟的受控狀態、攤平的列與每一列的勾選狀態。
 * 計算交給 `selectModel.ts` 的純函式；這裡只負責把它們接上 React 的狀態。
 */
export function useSelectModel<T extends string>(props: SelectProps<T>): SelectModel<T> {
  const {
    options,
    sortOptions: sortOrder,
    expandedValues,
    defaultExpandedValues,
    onExpandedChange,
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    searchable = false,
    searchValue,
    defaultSearchValue,
    onSearchChange,
    filterOption,
    clearSearchOnClose = true,
  } = props;
  const multi = props.multiple ? props : null;
  const isMultiple = multi !== null;
  const valueOrder = multi?.valueOrder ?? 'selection';
  const selectableGroups = !props.multiple && Boolean(props.selectableGroups);

  // ── 資料 ─────────────────────────────────────────────
  const sorted = useMemo(() => sortOptions(options, sortOrder), [options, sortOrder]);
  const index = useMemo(() => indexOptions(sorted), [sorted]);

  const controlledValue = useMemo(
    () => (props.value === undefined ? undefined : toArray<T>(props.value)),
    [props.value],
  );
  const [selected, setSelected] = useControllableState<readonly T[]>(
    controlledValue,
    toArray<T>(props.defaultValue),
    (next) => {
      if (props.multiple) props.onValueChange?.([...next]);
      else if (next[0] !== undefined) props.onValueChange?.(next[0]);
    },
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const [expanded, setExpanded] = useControllableState<readonly T[]>(
    expandedValues,
    defaultExpandedValues ?? EMPTY,
    onExpandedChange ? (next) => onExpandedChange([...next]) : undefined,
  );
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);

  const [open, setOpenState] = useControllableState(openProp, defaultOpen, onOpenChange);

  // ── 搜尋 ─────────────────────────────────────────────
  const [search, setSearch] = useControllableState(
    searchValue,
    defaultSearchValue ?? '',
    onSearchChange,
  );
  // 過濾用延後的值：大量選項時輸入框先更新，過濾與重繪在背景完成，打字不卡
  const deferredSearch = useDeferredValue(search);
  const query = searchable && filterOption !== false ? deferredSearch : '';
  const filtered = useMemo(
    () => filterOptions(sorted, query, filterOption || undefined),
    [sorted, query, filterOption],
  );
  // 勾選範圍（全選、群組）跟著畫面上看得到的選項；標籤與排序仍用完整的 index
  const viewIndex = useMemo(
    () => (filtered.options === sorted ? index : indexOptions(filtered.options)),
    [filtered.options, sorted, index],
  );
  // 搜尋時有符合子孫的群組一律展開（不改動使用者的展開狀態）
  const shownExpanded = useMemo(
    () => (filtered.groups.size ? new Set([...expandedSet, ...filtered.groups]) : expandedSet),
    [expandedSet, filtered.groups],
  );

  const flagsRef = useLatestRef({ searchable, clearSearchOnClose });
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      const flags = flagsRef.current;
      if (!next && flags.searchable && flags.clearSearchOnClose) setSearch('');
    },
    [flagsRef, setOpenState, setSearch],
  );

  // 開啟當下的已選快照：開啟期間勾選不重排（React 建議的「render 期間依前值調整 state」寫法，不會多閃一幀）
  const [pinned, setPinned] = useState<readonly T[] | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setPinned(open && multi?.pinSelected ? selected : null);
  }

  const rows = useMemo(
    () =>
      flattenRows(filtered.options, shownExpanded, {
        selectAll: Boolean(multi?.selectAll),
        pinned,
      }),
    [filtered.options, shownExpanded, multi?.selectAll, pinned],
  );
  const allState = useMemo(
    () =>
      viewIndex.enabledLeaves.length
        ? checkState(viewIndex.enabledLeaves, selectedSet)
        : 'unchecked',
    [viewIndex, selectedSet],
  );

  const rowState = (row: SelectRow<T>): CheckState => {
    if (row.kind === 'all') return allState;
    if (!row.isGroup || selectableGroups) {
      return selectedSet.has(row.key) ? 'checked' : 'unchecked';
    }
    const leaves = viewIndex.groupLeaves.get(row.key) ?? EMPTY;
    return isMultiple && leaves.length ? checkState(leaves, selectedSet) : 'unchecked';
  };
  const isRowDisabled = (row: SelectRow<T> | undefined): boolean => {
    if (!row) return true;
    if (row.kind === 'all') return viewIndex.enabledLeaves.length === 0;
    // selectableGroups：停用只作用在該列本身，子孫照常可選（例如不能放進去、但子資料夾可以的資料夾）
    if (selectableGroups ? row.option.disabled : row.disabled) return true;
    // 多選時，底下沒有任何可用選項的群組勾了也沒用；單選時群組列仍可展開
    return isMultiple && row.isGroup && !(viewIndex.groupLeaves.get(row.key)?.length ?? 0);
  };

  const displayValues = useMemo(
    () =>
      isMultiple && valueOrder === 'options' ? orderByOptions(selected, index.leafOrder) : selected,
    [isMultiple, valueOrder, selected, index],
  );

  return {
    multi,
    isMultiple,
    selectableGroups,
    valueOrder,
    searchable,
    isTree: index.hasGroups,
    index,
    viewIndex,
    selected,
    setSelected,
    expanded,
    setExpanded,
    shownExpanded,
    open,
    setOpen,
    search,
    setSearch,
    deferredSearch,
    rows,
    rowState,
    isRowDisabled,
    displayValues,
  };
}
