import type { ReactNode } from 'react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** 排序、搜尋與鍵盤 typeahead 用的文字；`label` 是字串時可省略。 */
  textValue?: string;
  /** 顯示在標籤下方的補充說明（列高會變成兩行，見 `Select` 的 `itemSize`）。 */
  description?: ReactNode;
  disabled?: boolean;
  /**
   * 子選項。有子選項的列是可展開的 **群組列**：本身不是值，
   * 單選時點它只會展開／收合；多選時勾它等於勾選底下所有可用的子孫選項。
   */
  children?: Array<SelectOption<T>>;
}

/** `asc` / `desc` 依 `textValue`（或字串 `label`）以自然順序排序；也可以傳比較函式。 */
export type SelectSortOrder<T extends string = string> =
  | 'asc'
  | 'desc'
  | ((a: SelectOption<T>, b: SelectOption<T>) => number);

/** 搜尋時判斷選項是否符合；群組列符合時保留整個群組。 */
export type SelectFilter<T extends string = string> = (
  option: SelectOption<T>,
  query: string,
) => boolean;

export type CheckState = 'checked' | 'indeterminate' | 'unchecked';

export type SelectRow<T extends string = string> =
  | { kind: 'all'; key: string; disabled: boolean; parentIndex: -1 }
  | {
      kind: 'option';
      key: T;
      option: SelectOption<T>;
      depth: number;
      isGroup: boolean;
      /** 自己或任何祖先被停用。 */
      disabled: boolean;
      /** 父群組列在 rows 裡的位置；頂層是 `-1`。 */
      parentIndex: number;
    };

export interface SelectIndex<T extends string = string> {
  /** 所有節點（含群組）。 */
  byValue: Map<T, SelectOption<T>>;
  /** 葉節點在樹狀順序中的位置，`valueOrder="options"` 時用來排序值。 */
  leafOrder: Map<T, number>;
  /** 群組 → 底下所有可用的葉節點（依樹狀順序）。 */
  groupLeaves: Map<T, T[]>;
  /** 整棵樹所有可用的葉節點（全選的對象）。 */
  enabledLeaves: T[];
  hasGroups: boolean;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 排序與 typeahead 用的文字。 */
export function optionText<T extends string>(option: SelectOption<T>): string {
  if (option.textValue !== undefined) return option.textValue;
  return typeof option.label === 'string' || typeof option.label === 'number'
    ? String(option.label)
    : option.value;
}

/** 依 `order` 排序（含子選項，各層各自排）；沒有 `order` 時原樣回傳同一個陣列。 */
export function sortOptions<T extends string>(
  options: Array<SelectOption<T>>,
  order: SelectSortOrder<T> | undefined,
): Array<SelectOption<T>> {
  if (!order) return options;
  const compare =
    typeof order === 'function'
      ? order
      : (a: SelectOption<T>, b: SelectOption<T>) =>
          collator.compare(optionText(a), optionText(b)) * (order === 'desc' ? -1 : 1);
  const visit = (list: Array<SelectOption<T>>): Array<SelectOption<T>> =>
    list
      .map((option) => (option.children ? { ...option, children: visit(option.children) } : option))
      .toSorted(compare);
  return visit(options);
}

/** 預設的搜尋比對：`textValue`（或字串 `label`）包含關鍵字，不分大小寫。 */
export function defaultFilterOption<T extends string>(
  option: SelectOption<T>,
  query: string,
): boolean {
  return optionText(option).toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

/**
 * 依關鍵字過濾（含子選項）：葉節點符合就保留、群組本身符合則保留整個群組，
 * 否則只留下有符合子孫的群組。回傳過濾後的樹與其中所有群組（搜尋時一律展開）。
 * 關鍵字是空白時原樣回傳同一個陣列。
 */
export function filterOptions<T extends string>(
  options: Array<SelectOption<T>>,
  query: string,
  filter: SelectFilter<T> = defaultFilterOption,
): { options: Array<SelectOption<T>>; groups: Set<T> } {
  const groups = new Set<T>();
  const trimmed = query.trim();
  if (!trimmed) return { options, groups };
  const visit = (list: Array<SelectOption<T>>): Array<SelectOption<T>> =>
    list.flatMap((option) => {
      if (!option.children) return filter(option, trimmed) ? [option] : [];
      const children = filter(option, trimmed) ? option.children : visit(option.children);
      if (!children.length) return [];
      groups.add(option.value);
      return [children === option.children ? option : { ...option, children }];
    });
  return { options: visit(options), groups };
}

export function indexOptions<T extends string>(options: Array<SelectOption<T>>): SelectIndex<T> {
  const byValue = new Map<T, SelectOption<T>>();
  const leafOrder = new Map<T, number>();
  const groupLeaves = new Map<T, T[]>();
  const enabledLeaves: T[] = [];
  let hasGroups = false;

  /** 回傳這個子樹底下可用的葉節點。 */
  const visit = (list: Array<SelectOption<T>>, parentDisabled: boolean): T[] => {
    const collected: T[] = [];
    for (const option of list) {
      byValue.set(option.value, option);
      const disabled = parentDisabled || Boolean(option.disabled);
      if (option.children) {
        hasGroups = true;
        const leaves = visit(option.children, disabled);
        groupLeaves.set(option.value, leaves);
        for (const leaf of leaves) collected.push(leaf);
      } else {
        leafOrder.set(option.value, leafOrder.size);
        if (!disabled) {
          collected.push(option.value);
          enabledLeaves.push(option.value);
        }
      }
    }
    return collected;
  };
  visit(options, false);

  return { byValue, leafOrder, groupLeaves, enabledLeaves, hasGroups };
}

/**
 * 把樹攤平成畫面上的列：只展開 `expanded` 裡的群組。
 * `pinned` 只在沒有群組時生效：這些值依給定順序排在最前面，其餘維持原順序。
 */
export function flattenRows<T extends string>(
  options: Array<SelectOption<T>>,
  expanded: ReadonlySet<T>,
  { selectAll = false, pinned }: { selectAll?: boolean; pinned?: readonly T[] | null } = {},
): Array<SelectRow<T>> {
  const rows: Array<SelectRow<T>> = [];
  if (selectAll && options.length)
    rows.push({ kind: 'all', key: '__all__', disabled: false, parentIndex: -1 });

  const hasGroups = options.some((option) => option.children);
  let list = options;
  if (pinned?.length && !hasGroups) {
    const pinnedSet = new Set(pinned);
    const byValue = new Map(options.map((option) => [option.value, option]));
    const head = pinned.flatMap((value) => byValue.get(value) ?? []);
    list = [...head, ...options.filter((option) => !pinnedSet.has(option.value))];
  }

  const visit = (
    items: Array<SelectOption<T>>,
    depth: number,
    parentIndex: number,
    parentDisabled: boolean,
  ) => {
    for (const option of items) {
      const disabled = parentDisabled || Boolean(option.disabled);
      const isGroup = Boolean(option.children);
      const index = rows.length;
      rows.push({
        kind: 'option',
        key: option.value,
        option,
        depth,
        isGroup,
        disabled,
        parentIndex,
      });
      if (option.children && expanded.has(option.value)) {
        visit(option.children, depth + 1, index, disabled);
      }
    }
  };
  visit(list, 0, -1, false);
  return rows;
}

/** `leaves` 在 `selected` 裡的勾選狀態；空集合視為未勾選。 */
export function checkState<T>(leaves: readonly T[], selected: ReadonlySet<T>): CheckState {
  let count = 0;
  for (const leaf of leaves) if (selected.has(leaf)) count += 1;
  if (count === 0) return 'unchecked';
  return count === leaves.length ? 'checked' : 'indeterminate';
}

/**
 * 把 `values` 加入（附加在尾端，保留勾選先後）或移出 `current`。
 * 回傳新陣列；沒有變化時回傳原陣列。
 */
export function toggleValues<T>(
  current: readonly T[],
  values: readonly T[],
  select: boolean,
): readonly T[] {
  if (select) {
    const existing = new Set(current);
    const added = values.filter((value) => !existing.has(value));
    return added.length ? [...current, ...added] : current;
  }
  const removed = new Set(values);
  const next = current.filter((value) => !removed.has(value));
  return next.length === current.length ? current : next;
}

/** 依選項順序排列；不在選項裡的值（例如還沒載入的頁）保留原順序放在最後。 */
export function orderByOptions<T>(values: readonly T[], leafOrder: ReadonlyMap<T, number>): T[] {
  return values
    .map((value, position) => ({ value, rank: leafOrder.get(value) ?? leafOrder.size + position }))
    .toSorted((a, b) => a.rank - b.rank)
    .map((entry) => entry.value);
}
