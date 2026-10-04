import { Popover as BasePopover } from '@base-ui/react/popover';
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  Ref,
} from 'react';

import { cn } from '@/shared/utils';

import { BoxEllipsis } from '../Ellipsis';
import { Icon } from '../Icon';
import { useComponentLabels } from '../labels';
import { createSlots } from '../slots';
import type { SlotOverrides, SlotResolver } from '../slots';
import { Spinner } from '../Spinner';
import { useControllableState } from '../useControllableState';
import { useLatestRef } from '../useLatestRef';
import {
  useInfiniteScroll,
  useListNavigation,
  useVirtualRows,
  withRowPosition,
} from '../VirtualList';
import {
  checkState,
  filterOptions,
  flattenRows,
  indexOptions,
  optionText,
  orderByOptions,
  sortOptions,
  toggleValues,
} from './selectModel';
import type {
  CheckState,
  SelectFilter,
  SelectOption,
  SelectRow,
  SelectSortOrder,
} from './selectModel';

import styles from './Select.module.css';

export type { CheckState, SelectFilter, SelectOption, SelectSortOrder } from './selectModel';
export { defaultFilterOption } from './selectModel';

/**
 * `className` / `style` / `data-testid` / `aria-label` / `ref` 落在觸發按鈕；
 * 其餘各層用 `classNames` / `styles` / `testIds` 覆寫。
 */
export type SelectSlot =
  | 'value'
  | 'placeholder'
  | 'tag'
  | 'icon'
  | 'positioner'
  | 'popup'
  | 'search'
  | 'searchInput'
  | 'scroller'
  | 'list'
  | 'item'
  | 'expander'
  | 'indicator'
  | 'itemText'
  | 'itemDescription'
  | 'footer';

interface SelectBaseProps<T extends string> extends SlotOverrides<SelectSlot> {
  ref?: Ref<HTMLButtonElement>;
  options: Array<SelectOption<T>>;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  size?: 'sm' | 'md';
  /** 選項排序（含子選項）。傳函式時請保持參考穩定，否則每次 render 都會重排。 */
  sortOptions?: SelectSortOrder<T>;
  /** 展開中的群組列（expandable rows）。 */
  expandedValues?: T[];
  defaultExpandedValues?: T[];
  onExpandedChange?: (values: T[]) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 在彈出層頂端顯示搜尋框，輸入時過濾選項（群組只留下有符合子孫的，並自動展開）。 */
  searchable?: boolean;
  searchValue?: string;
  defaultSearchValue?: string;
  /** 搜尋字改變時呼叫；搭配 `filterOption={false}` ＋ `onLoadMore` 做後端搜尋與分頁。 */
  onSearchChange?: (query: string) => void;
  /**
   * 本地過濾規則。預設比對 `textValue`（或字串 `label`）是否包含關鍵字、不分大小寫；
   * `false` 表示不在本地過濾（選項由呼叫端依 `onSearchChange` 更新）。傳函式時請保持參考穩定。
   */
  filterOption?: SelectFilter<T> | false;
  searchPlaceholder?: string;
  /** 搜尋框的無障礙名稱。預設同 `searchPlaceholder`。 */
  searchLabel?: string;
  /** 關閉時清空搜尋字。預設 `true`。 */
  clearSearchOnClose?: boolean;
  /** 有搜尋字但沒有符合的選項時顯示。 */
  noMatchLabel?: ReactNode;
  /** 無限捲動：還有下一頁。 */
  hasMore?: boolean;
  /** 無限捲動：正在載入下一頁（底部顯示載入中）。 */
  loading?: boolean;
  /** 無限捲動：捲到接近底部（或內容不滿一屏）時呼叫。 */
  onLoadMore?: () => void;
  loadingLabel?: string;
  /** 沒有選項、也不在載入中時顯示（有搜尋字時改顯示 `noMatchLabel`）。 */
  emptyLabel?: ReactNode;
  /** 列數超過這個值才虛擬捲動。預設 100。 */
  virtualThreshold?: number;
  /**
   * 列高（px），要與 CSS 的列高一致，虛擬捲動才不會在量測後跳動。預設 32；
   * 選項有 `description`（兩行）時建議設 48。
   */
  itemSize?: number;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'data-testid'?: string;
}

export interface SingleSelectProps<T extends string = string> extends SelectBaseProps<T> {
  multiple?: false;
  value?: T | null;
  defaultValue?: T | null;
  onValueChange?: (value: T) => void;
  /**
   * 群組列本身也是值（例如資料夾樹：有子資料夾的資料夾也能選）：點列選取並關閉，
   * 展開收合改由列首的箭頭與 ←／→。選項的 `disabled` 只停用該列本身、不連帶停用子孫。
   * 預設 `false`：單選時群組列只會展開／收合。
   */
  selectableGroups?: boolean;
}

export interface MultipleSelectProps<T extends string = string> extends SelectBaseProps<T> {
  multiple: true;
  value?: T[];
  defaultValue?: T[];
  onValueChange?: (value: T[]) => void;
  /**
   * 值（以及觸發鈕上標籤）的排列方式：
   * `selection` 依勾選先後（預設），`options` 依選項順序。
   */
  valueOrder?: 'selection' | 'options';
  /** 列表頂端顯示「全選」列（只作用在目前已載入、未停用的選項）。Ctrl/⌘ + A 也會切換全選。 */
  selectAll?: boolean;
  selectAllLabel?: ReactNode;
  /**
   * 開啟時把已選項目排到最前面（依 `value` 的順序）。只取開啟當下的快照，
   * 開啟期間勾選不會重排，列表不會跳動。有群組列時不作用。
   */
  pinSelected?: boolean;
  /** 觸發鈕上最多顯示幾個標籤，其餘收成 `+N`；未設定時依寬度自動收合。 */
  maxTagCount?: number;
}

export type SelectProps<T extends string = string> = SingleSelectProps<T> | MultipleSelectProps<T>;

const DEFAULT_ITEM_SIZE = 32;
/** 觸發鈕最多實際渲染幾個標籤再交給 BoxEllipsis 量測；全選上萬筆時不必每個都量。 */
const MAX_RENDERED_TAGS = 50;
const EMPTY: readonly never[] = [];

function toArray<T>(value: T | readonly T[] | null | undefined): readonly T[] {
  if (value === null || value === undefined) return EMPTY;
  return Array.isArray(value) ? (value as readonly T[]) : [value as T];
}

interface SelectRowViewProps<T extends string> {
  row: SelectRow<T>;
  index: number;
  id: string;
  start: number | undefined;
  isActive: boolean;
  isDisabled: boolean;
  isExpanded: boolean;
  state: CheckState;
  isMultiple: boolean;
  isTree: boolean;
  /** 單選時群組列也是值（`selectableGroups`）。 */
  isGroupSelectable: boolean;
  label: ReactNode;
  description: ReactNode;
  slot: SlotResolver<SelectSlot>;
  measureElement: ((element: Element | null) => void) | undefined;
  onPick: (index: number) => void;
  onToggleExpand: (index: number) => void;
  onHover: (index: number) => void;
}

/**
 * 一列。以 `memo` 包住，所有 callback 都是固定參考：
 * 勾選一個項目時只有狀態改變的列（該列、它的祖先群組、全選列）重新 render。
 * 勾選框常駐、只換 `data-state`，列的寬高不會因為勾選而改變。
 */
const SelectRowView = memo(function SelectRowView<T extends string>({
  row,
  index,
  id,
  start,
  isActive,
  isDisabled,
  isExpanded,
  state,
  isMultiple,
  isTree,
  isGroupSelectable,
  label,
  description,
  slot,
  measureElement,
  onPick,
  onToggleExpand,
  onHover,
}: SelectRowViewProps<T>) {
  const isGroup = row.kind === 'option' && row.isGroup;
  const depth = row.kind === 'option' ? row.depth : 0;
  const item = slot('item', styles.item, { testId: 'select-item' });
  const style = { ...item.style, '--select-depth': depth } as CSSProperties;
  return (
    // 鍵盤操作在列表容器上（aria-activedescendant），列本身只接滑鼠；role 依是否為樹而定，lint 無法靜態判斷
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      id={id}
      ref={measureElement}
      role={isTree ? 'treeitem' : 'option'}
      aria-selected={isGroup && !isMultiple && !isGroupSelectable ? undefined : state === 'checked'}
      aria-checked={isMultiple && state === 'indeterminate' ? 'mixed' : undefined}
      aria-disabled={isDisabled || undefined}
      aria-expanded={isGroup ? isExpanded : undefined}
      aria-level={isTree ? depth + 1 : undefined}
      className={item.className}
      style={withRowPosition(style, start)}
      data-testid={item['data-testid']}
      data-index={index}
      data-value={row.key}
      data-kind={row.kind === 'all' ? 'all' : isGroup ? 'group' : 'option'}
      data-state={state}
      data-selected={state === 'checked' || undefined}
      data-highlighted={isActive || undefined}
      data-disabled={isDisabled || undefined}
      data-described={description ? true : undefined}
      onClick={() => {
        if (!isDisabled) onPick(index);
      }}
      // 用 pointermove 而不是 pointerenter：列表捲動經過靜止的游標時不會亂換作用列
      onPointerMove={() => {
        if (!isActive) onHover(index);
      }}
    >
      {isTree && (
        // listbox / tree 裡不能再放可聚焦的按鈕；鍵盤以 ←／→ 展開收合，這裡只接滑鼠點擊
        <span
          aria-hidden
          {...slot('expander', styles.expander)}
          data-expanded={isExpanded || undefined}
          onClick={(event: ReactMouseEvent) => {
            if (!isGroup) return;
            event.stopPropagation();
            onToggleExpand(index);
          }}
        >
          {isGroup && <Icon name="chevron-right" size={14} />}
        </span>
      )}
      {isMultiple ? (
        <span aria-hidden {...slot('indicator', styles.checkbox)} data-state={state}>
          <Icon name={state === 'indeterminate' ? 'minus' : 'check'} size={14} />
        </span>
      ) : (
        <span aria-hidden {...slot('indicator', styles.indicator)} data-state={state}>
          <Icon name="check" size={14} />
        </span>
      )}
      <span {...slot('itemText', styles.itemText)}>
        <span className={styles.itemLabel}>{label}</span>
        {description && (
          <span {...slot('itemDescription', styles.itemDescription)}>{description}</span>
        )}
      </span>
    </div>
  );
}) as <T extends string>(props: SelectRowViewProps<T>) => ReactNode;

/**
 * 下拉選擇，單選或多選（`multiple`）。
 *
 * - 以 Base UI Popover 負責定位、點外面／Esc 關閉與焦點歸還；列表以 `aria-activedescendant`
 *   自己管理作用列，才能虛擬捲動（Base UI Select 需要所有選項都掛在 DOM 上）。
 * - 列數多時自動虛擬捲動；傳 `onLoadMore` ＋ `hasMore` 即為無限捲動。
 * - 選項有 `children` 時成為可展開的樹（role="tree"）。
 */
export function Select<T extends string = string>(props: SelectProps<T>) {
  // 沒有明確傳入的文案用目前語系（ComponentLabelsContext），英文介面不會漏出中文預設值
  const labels = useComponentLabels();
  const {
    ref,
    options,
    placeholder,
    disabled,
    invalid,
    size = 'md',
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
    searchPlaceholder = labels.selectSearch,
    searchLabel,
    clearSearchOnClose = true,
    noMatchLabel = labels.selectNoMatch,
    hasMore,
    loading,
    onLoadMore,
    loadingLabel = labels.selectLoading,
    emptyLabel,
    virtualThreshold,
    itemSize = DEFAULT_ITEM_SIZE,
    className,
    style,
    classNames,
    styles: styleOverrides,
    testIds,
    'aria-label': ariaLabel,
    'data-testid': testId,
  } = props;
  const multi = props.multiple ? props : null;
  const isMultiple = multi !== null;
  const valueOrder = multi?.valueOrder ?? 'selection';
  const selectableGroups = !props.multiple && Boolean(props.selectableGroups);

  const slot = useMemo(
    () => createSlots({ classNames, styles: styleOverrides, testIds }),
    [classNames, styleOverrides, testIds],
  );
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = useCallback((index: number) => `${baseId}-${index}`, [baseId]);

  // ── 資料 ─────────────────────────────────────────────
  const sorted = useMemo(() => sortOptions(options, sortOrder), [options, sortOrder]);
  const index = useMemo(() => indexOptions(sorted), [sorted]);
  const isTree = index.hasGroups;

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

  // ── 捲動 ─────────────────────────────────────────────
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const {
    rows: visibleRows,
    containerStyle,
    measureElement,
    scrollToIndex,
  } = useVirtualRows({
    count: rows.length,
    scrollElement,
    estimateSize: itemSize,
    threshold: virtualThreshold,
  });
  const { onScroll } = useInfiniteScroll({
    scrollElement,
    count: rows.length,
    hasMore,
    loading,
    onLoadMore,
    // 換關鍵字等於換一份資料：解除分頁的鎖
    resetKey: deferredSearch,
  });

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

  // ── 觸發鈕上的值 ─────────────────────────────────────
  const labelOf = (value: T): ReactNode => index.byValue.get(value)?.label ?? value;
  const displayValues = useMemo(
    () =>
      isMultiple && valueOrder === 'options' ? orderByOptions(selected, index.leafOrder) : selected,
    [isMultiple, valueOrder, selected, index],
  );
  const renderedTags = displayValues.slice(0, MAX_RENDERED_TAGS);
  const unrenderedCount = displayValues.length - renderedTags.length;

  let display: ReactNode;
  if (displayValues.length === 0) {
    display = <span {...slot('placeholder', styles.placeholder)}>{placeholder ?? ''}</span>;
  } else if (!isMultiple) {
    display = labelOf(displayValues[0] as T);
  } else {
    display = (
      <BoxEllipsis
        className={styles.tags}
        maxVisible={multi?.maxTagCount}
        overflowTooltip={false}
        renderOverflow={({ hiddenCount }) => (
          <span className={styles.tag} data-overflow>
            +{hiddenCount + unrenderedCount}
          </span>
        )}
      >
        {renderedTags.map((value) => (
          <span
            key={value}
            {...slot('tag', styles.tag, { testId: 'select-tag' })}
            data-value={value}
          >
            {labelOf(value)}
          </span>
        ))}
      </BoxEllipsis>
    );
  }

  const listSlot = slot('list', styles.list);
  const emptyContent =
    rows.length === 0 && !loading ? (search.trim() ? noMatchLabel : emptyLabel) : undefined;
  const activeId = activeIndex >= 0 ? optionId(activeIndex) : undefined;

  return (
    <BasePopover.Root open={open} onOpenChange={(next) => setOpen(next)}>
      <BasePopover.Trigger
        ref={ref}
        disabled={disabled}
        // 「只能選、不能打字」的 combobox 用 button 實作（WAI-ARIA APG 的 select-only combobox）
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="combobox"
        aria-haspopup={isTree ? 'tree' : 'listbox'}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn(styles.trigger, className)}
        style={style}
        data-testid={testId}
        data-size={size}
        data-multiple={isMultiple || undefined}
        data-placeholder={displayValues.length === 0 || undefined}
        onKeyDown={(event: KeyboardEvent) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span {...slot('value', styles.value)}>{display}</span>
        <span {...slot('icon', styles.icon)}>
          <Icon name="chevron-down" size={16} />
        </span>
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner sideOffset={4} {...slot('positioner', styles.positioner)}>
          <BasePopover.Popup
            role="presentation"
            initialFocus={searchable ? inputRef : listRef}
            {...slot('popup', styles.popup)}
          >
            {searchable && (
              <div {...slot('search', styles.search)}>
                <Icon name="search" size={14} />
                <input
                  ref={inputRef}
                  type="text"
                  role="combobox"
                  aria-expanded={open}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={activeId}
                  aria-label={searchLabel ?? searchPlaceholder}
                  placeholder={searchPlaceholder}
                  value={search}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={onListKeyDown}
                  {...slot('searchInput', styles.searchInput, { testId: 'select-search' })}
                />
              </div>
            )}
            {/* 捲動容器獨立一層：搜尋框固定在上方，虛擬捲動與無限捲動只量列表 */}
            <div ref={setScrollElement} onScroll={onScroll} {...slot('scroller', styles.scroller)}>
              {/* role 依是否為樹而定，lint 無法靜態判斷 */}
              {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
              <div
                ref={listRef}
                id={listId}
                role={isTree ? 'tree' : 'listbox'}
                tabIndex={-1}
                aria-label={ariaLabel}
                aria-multiselectable={isMultiple || undefined}
                // 有搜尋框時焦點在輸入框上，由它宣告 aria-activedescendant
                aria-activedescendant={searchable ? undefined : activeId}
                onKeyDown={onListKeyDown}
                className={listSlot.className}
                style={containerStyle ? { ...listSlot.style, ...containerStyle } : listSlot.style}
                data-testid={listSlot['data-testid']}
                data-multiple={isMultiple || undefined}
              >
                {visibleRows.map(({ index: rowIndex, start }) => {
                  const row = rows[rowIndex];
                  if (!row) return null;
                  return (
                    <SelectRowView<T>
                      key={row.key}
                      row={row}
                      index={rowIndex}
                      id={optionId(rowIndex)}
                      start={start}
                      isActive={rowIndex === activeIndex}
                      isDisabled={isRowDisabled(row)}
                      isExpanded={row.kind === 'option' && shownExpanded.has(row.key)}
                      state={rowState(row)}
                      isMultiple={isMultiple}
                      isTree={isTree}
                      isGroupSelectable={selectableGroups}
                      label={
                        row.kind === 'all'
                          ? (multi?.selectAllLabel ?? labels.selectAll)
                          : row.option.label
                      }
                      description={row.kind === 'option' ? row.option.description : undefined}
                      slot={slot}
                      measureElement={measureElement}
                      onPick={pick}
                      onToggleExpand={toggleExpand}
                      onHover={setActiveIndex}
                    />
                  );
                })}
              </div>
              {(loading || emptyContent) && (
                <div {...slot('footer', styles.footer, { testId: 'select-footer' })}>
                  {loading ? <Spinner size={16} label={loadingLabel} /> : emptyContent}
                </div>
              )}
            </div>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
