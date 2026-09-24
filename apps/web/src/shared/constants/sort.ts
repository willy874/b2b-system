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

/** 後端的查詢參數 `sort=<欄位>:<方向>`（可重複，docs/architecture/backend/03-api-conventions.md §2.1）。 */
export function toSortParams(entries: readonly SortEntry[]): string[] {
  return entries.map(({ sort, order }) => `${sort}:${order}`);
}

/**
 * 網址上的排序狀態：白名單欄位、同一欄位不重複、至少一個。
 * 使用者手改網址成不合法的值時退回 `fallback`，不變成錯誤頁（與其他 search 欄位的 `.catch()` 一致）。
 */
export function sortSearchSchema<const T extends readonly [string, ...string[]]>(
  fields: T,
  fallback: Array<SortEntry<T[number]>>,
) {
  return z
    .array(z.object({ sort: z.enum(fields), order: z.enum(SORT_ORDERS) }))
    .min(1)
    .max(fields.length)
    .refine((entries) => new Set(entries.map((entry) => entry.sort)).size === entries.length)
    .default(fallback)
    .catch(fallback);
}
