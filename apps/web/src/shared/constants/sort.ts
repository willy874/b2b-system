import { z } from 'zod';

export const SortOrder = {
  ASC: 'asc',
  DESC: 'desc',
} as const;

export type SortOrderType = (typeof SortOrder)[keyof typeof SortOrder];

export const SORT_ORDERS = [SortOrder.ASC, SortOrder.DESC] as const;

export function isSortOrder(value: unknown): value is SortOrderType {
  return value === SortOrder.ASC || value === SortOrder.DESC;
}

/**
 * 一個排序條件（資料結構同 merak-client 的 `SortEntry`）；
 * `SortEntry[]` 的順序就是優先順序，第一個是主排序。
 */
export interface SortEntry<TField extends string = string> {
  sort: TField;
  order: SortOrderType;
}

export function isSortEntry(value: unknown): value is SortEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SortEntry).sort === 'string' &&
    isSortOrder((value as SortEntry).order)
  );
}

/**
 * 查詢字串上的一個排序條件：`createdAt` 升冪、`-createdAt` 降冪。
 * 網址與後端 API 共用這個格式（`sort` 可重複，docs/architecture/backend/03-api-conventions.md §2.1）。
 */
export function toSortToken({ sort, order }: SortEntry): string {
  return order === SortOrder.DESC ? `-${sort}` : sort;
}

export function parseSortToken(token: string): SortEntry {
  return token.startsWith('-')
    ? { sort: token.slice(1), order: SortOrder.DESC }
    : { sort: token, order: SortOrder.ASC };
}

export function toSortParams(entries: readonly SortEntry[]): string[] {
  return entries.map(toSortToken);
}

/** 網址上的 `sort=a&sort=-b`（單一時是字串、重複時是陣列）→ `SortEntry[]`；已經是物件的原樣留下。 */
function parseSortSearch(value: unknown): unknown {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value]).map((item: unknown) =>
    typeof item === 'string' ? parseSortToken(item) : item,
  );
}

/**
 * 網址上的排序狀態：白名單欄位、同一欄位不重複。
 * 網址上是 `sort` token（見 `toSortToken`），進到元件的是 `SortEntry[]`；
 * 導覽時由 `core/router` 的 `stringifySearch` 轉回 token。
 * 空陣列＝使用者沒指定排序：不送 `sort`，由後端套用預設排序。
 * 使用者手改網址成不合法的值時退回空陣列，不變成錯誤頁（與其他 search 欄位的 `.catch()` 一致）。
 */
export function sortSearchSchema<const T extends readonly [string, ...string[]]>(fields: T) {
  const empty: Array<SortEntry<T[number]>> = [];
  return z
    .preprocess(
      parseSortSearch,
      z
        .array(z.object({ sort: z.enum(fields), order: z.enum(SORT_ORDERS) }))
        .max(fields.length)
        .refine((entries) => new Set(entries.map((entry) => entry.sort)).size === entries.length),
    )
    .default(empty)
    .catch(empty);
}
