import type { CSSProperties, ReactNode, Ref } from 'react';

import type { SlotOverrides } from '../slots';
import type { SelectFilter, SelectOption, SelectSortOrder } from './selectModel';
import type { SelectSlot } from './selectSlots';

export interface SelectBaseProps<T extends string> extends SlotOverrides<SelectSlot> {
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
  /**
   * 觸發鈕與列表的名稱。放在 `Field` 裡時可以不傳：沒有傳就以 `aria-labelledby` 指向 `Field` 的標籤，
   * `Field` 的說明與錯誤也會連到 `aria-describedby`。
   */
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
