import { z } from 'zod';

export const PaginationSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationSchema>;

export interface PaginationMeta {
  offset: number;
  limit: number;
  total: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export function paginated<T>(
  items: T[],
  total: number,
  query: PaginationQuery,
): PaginatedResult<T> {
  return { items, pagination: { offset: query.offset, limit: query.limit, total } };
}

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** 一個排序條件；陣列的順序就是優先順序（第一個是主排序）。 */
export interface SortEntry<TField extends string = string> {
  sort: TField;
  order: SortOrder;
}

/**
 * 查詢字串的 `sort=createdAt:desc&sort=name:asc` → `[{ sort, order }, …]`。
 * 格式不對的值原樣留下，交給後面的 schema 回 400。
 */
function parseSortTokens(value: unknown): unknown {
  if (value === undefined) return undefined;
  const tokens = Array.isArray(value) ? value : [value];
  return tokens.map((token) => {
    if (typeof token !== 'string') return token;
    const [sort, order, ...rest] = token.split(':');
    return rest.length ? token : { sort, order };
  });
}

/**
 * 多欄排序（`sort=<欄位>:<asc|desc>`，可重複）。
 * 欄位必須是白名單 enum，不接受任意欄位名——那是 SQL injection 的入口，也會讓沒有索引的欄位被拿來排序；
 * 同一欄位不能出現兩次。沒帶時預設 `<fields[0]>:desc`。
 */
export const SortSchema = <const T extends readonly [string, ...string[]]>(fields: T) =>
  z.object({
    sort: z.preprocess(
      parseSortTokens,
      z
        .array(z.object({ sort: z.enum(fields), order: z.enum(SORT_ORDERS) }))
        .min(1)
        .max(fields.length)
        .refine((entries) => new Set(entries.map((entry) => entry.sort)).size === entries.length, {
          message: 'duplicate sort field',
        })
        .default([{ sort: fields[0], order: 'desc' }]),
    ),
  });
