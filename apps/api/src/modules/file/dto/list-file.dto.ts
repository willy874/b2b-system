import { z } from 'zod';

import { PaginationSchema, SortSchema } from '@/core/http';

export const ListFileSchema = PaginationSchema.extend({
  /** 檔名的部分比對（不分大小寫）。 */
  keyword: z.string().trim().max(100).optional(),
  /** `image/png` 精確比對；`image/*` 比對整個主類型。 */
  contentType: z
    .string()
    .trim()
    .toLowerCase()
    .max(255)
    .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/(\*|[a-z0-9][a-z0-9!#$&^_.+-]*)$/)
    .optional(),
}).extend(SortSchema(['createdAt', 'name', 'size']).shape);

export type ListFileDto = z.infer<typeof ListFileSchema>;
