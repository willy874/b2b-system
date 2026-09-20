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

/** `sortBy` 必須是白名單 enum，不接受任意欄位名。 */
export const SortSchema = <T extends readonly [string, ...string[]]>(fields: T) =>
  z.object({
    sortBy: z.enum(fields).default(fields[0]),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  });
