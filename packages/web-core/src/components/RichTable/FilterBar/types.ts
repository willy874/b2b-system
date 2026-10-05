import type { SortEntry } from '@b2b-system/web-shared/constants';
import type { ReactNode } from 'react';

export interface FilterOption<T extends string = string> {
  /** 不可為空字串（`select` 以空字串代表「全部」）。 */
  value: T;
  label: string;
}

interface FilterFieldBase<K extends string> {
  /** 對應 `value` 物件裡的哪一個屬性；同時是欄位容器的 `data-value`。 */
  key: K;
  /** 顯示在控制項上方的標題，也是控制項的無障礙名稱。 */
  label: string;
  disabled?: boolean;
}

/** 文字輸入；在輸入框按 Enter 等同按「搜尋」。空字串送出 `undefined`。 */
export interface TextFilterField<K extends string = string> extends FilterFieldBase<K> {
  type: 'text';
  placeholder?: string;
}

/** 下拉單選；第一項是「全部」（`undefined`）。 */
export interface SelectFilterField<
  K extends string = string,
  T extends string = string,
> extends FilterFieldBase<K> {
  type: 'select';
  options: Array<FilterOption<T>>;
  /** 「全部」選項的文字，預設 `common.all`。 */
  allLabel?: string;
}

/** 勾選清單；全部取消時送出 `undefined`。 */
export interface MultiSelectFilterField<
  K extends string = string,
  T extends string = string,
> extends FilterFieldBase<K> {
  type: 'multiSelect';
  options: Array<FilterOption<T>>;
}

/** 日期（`YYYY-MM-DD`）區間。 */
export interface DateRangeFilterValue {
  from?: string;
  to?: string;
}

export interface DateRangeFilterField<K extends string = string> extends FilterFieldBase<K> {
  type: 'dateRange';
  /** 可選的最早／最晚日期（`YYYY-MM-DD`） */
  min?: string;
  max?: string;
  /** 區間最多涵蓋幾天（含頭尾），對應後端的查詢範圍上限 */
  maxSpanDays?: number;
}

/**
 * 多欄排序（資料結構同 merak-client 的 `SortEntry[]`）：每列選欄位與方向，拖曳調整優先順序，
 * 同一欄位只能出現一次。全部移除時送出空陣列，由頁面決定改用預設排序。
 */
export interface SortFilterField<
  K extends string = string,
  T extends string = string,
> extends FilterFieldBase<K> {
  type: 'sort';
  /** 可以排序的欄位。 */
  options: Array<FilterOption<T>>;
}

/**
 * 內建型別不夠用時，自己渲染控制項；`value` / `onChange` 讀寫的是草稿，送出時才生效。
 * `render` 用方法語法宣告（參數雙變），`FilterField<TValues>` 才能放進不分型別的陣列。
 */
export interface CustomFilterField<
  K extends string = string,
  V = unknown,
> extends FilterFieldBase<K> {
  type: 'custom';
  /** 決定按鈕上的數量是否計入這個欄位；預設「值不是 `undefined`」。 */
  isActive?(value: V): boolean;
  render(context: { value: V; onChange: (value: V) => void }): ReactNode;
}

type ElementOf<V> = V extends ReadonlyArray<infer E> ? E : never;

/**
 * 依 `value` 物件裡該屬性的型別，決定這個 key 可以用哪些欄位型別：
 * 字串 → `text` / `select`，字串陣列 → `multiSelect`，`DateRangeFilterValue` → `dateRange`，
 * `SortEntry[]` → `sort`，任何型別都能用 `custom`。
 * 用 `[V]` 包起來避免分配，`select` 的選項型別才會是整個聯集。
 */
type FieldFor<K extends string, V> =
  | ([V] extends [string | undefined]
      ? TextFilterField<K> | SelectFilterField<K, Extract<V, string>>
      : never)
  | ([V] extends [ReadonlyArray<string> | undefined]
      ? MultiSelectFilterField<K, Extract<ElementOf<NonNullable<V>>, string>>
      : never)
  | ([V] extends [DateRangeFilterValue | undefined] ? DateRangeFilterField<K> : never)
  | ([V] extends [ReadonlyArray<SortEntry> | undefined]
      ? SortFilterField<K, Extract<ElementOf<NonNullable<V>>, SortEntry>['sort']>
      : never)
  | CustomFilterField<K, V>;

/**
 * 不分 key 與值型別的欄位：`FilterBar` 內部與控制項使用。
 * 任何 `FilterField<TValues>` 都能指派給它（`custom` 的 `render` 是方法語法、參數雙變）。
 */
export type AnyFilterField =
  | TextFilterField
  | SelectFilterField
  | MultiSelectFilterField
  | DateRangeFilterField
  | SortFilterField
  | CustomFilterField;

/** `value` 物件（例：`{ keyword?: string; status?: UserStatus }`）對應的欄位定義。 */
export type FilterField<TValues extends Record<string, unknown> = Record<string, unknown>> = {
  [K in keyof TValues & string]: FieldFor<K, TValues[K]>;
}[keyof TValues & string];

/** `className` / `data-testid` 落在「篩選」按鈕；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type FilterBarSlot =
  | 'count'
  | 'popup'
  | 'form'
  | 'field'
  | 'fieldLabel'
  | 'footer'
  | 'reset'
  | 'submit';

export interface FilterBarLabels {
  /** 預設 `common.clear`。 */
  reset?: string;
  /** 預設 `common.search`。 */
  submit?: string;
}
