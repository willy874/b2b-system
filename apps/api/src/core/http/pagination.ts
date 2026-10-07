import { z } from 'zod';

/**
 * offset 的上限。offset 分頁要先掃過前面的每一列，極大的 offset 等於全表掃描；
 * 超過 1 萬筆的瀏覽應該改用篩選條件縮小範圍。
 * 上限也擋掉 `offset=1e19` 這種超出 bigint 的值。
 */
export const MAX_OFFSET = 10_000;

/** 列表的 `offset`：0 ～ `MAX_OFFSET`。自訂 limit 範圍的列表（稽核、背景工作）也用這個。 */
export const OffsetSchema = z.coerce.number().int().min(0).max(MAX_OFFSET).default(0);

export const PaginationSchema = z.object({
  offset: OffsetSchema,
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
 * 查詢字串的 `sort=-createdAt&sort=name` → `[{ sort: 'createdAt', order: 'desc' }, { sort: 'name', order: 'asc' }]`：
 * 欄位名前面加 `-` 是降冪，沒加是升冪。欄位名不合法（含 `--name`、`name:asc`）交給後面的 schema 回 400。
 */
function parseSortTokens(value: unknown): unknown {
  if (value === undefined) return undefined;
  const tokens = Array.isArray(value) ? value : [value];
  return tokens.map((token) => {
    if (typeof token !== 'string') return token;
    return token.startsWith('-')
      ? { sort: token.slice(1), order: 'desc' }
      : { sort: token, order: 'asc' };
  });
}

/**
 * 多欄排序（`sort=<欄位>` 升冪、`sort=-<欄位>` 降冪，可重複）。
 * 欄位必須是白名單 enum，不接受任意欄位名——那是 SQL injection 的入口，也會讓沒有索引的欄位被拿來排序；
 * 同一欄位不能出現兩次。沒帶時預設 `-<fields[0]>`。
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

/**
 * 可以重複的查詢參數（`?status=a&status=b`）：express 給陣列，只有一個時給字串，統一成陣列。
 * 用在列表的多選篩選；陣列之間是「其中任一個」。
 */
export function QueryArraySchema<T extends z.ZodTypeAny>(
  schema: T,
): z.ZodOptional<z.ZodType<Array<z.output<T>>>> {
  return z
    .preprocess((value) => (Array.isArray(value) ? value : [value]), z.array(schema).max(50))
    .optional();
}
