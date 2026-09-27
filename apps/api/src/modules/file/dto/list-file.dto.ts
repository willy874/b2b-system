import { z } from 'zod';

import { PaginationSchema, SortSchema } from '@/core/http';

import { FILE_CATEGORIES } from '../file.constants';

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
  /** 分類（`file.constants.ts` 的 `FILE_CATEGORY_RULES`）；`other` 是不屬於其他分類的檔案。 */
  category: z.enum(FILE_CATEGORIES).optional(),
  /** 只列這個人上傳的檔案。 */
  uploaderId: z.string().uuid().optional(),
  /**
   * keyset 分頁的游標（上一頁回應的 `nextCursor`）：無限捲動用，捲動途中有人新增或刪除也不會重複或漏掉。
   * 帶游標時忽略 `offset`，且只依 `sort` 的第一個條件（＋ id）排序。
   */
  cursor: z.string().trim().max(1000).optional(),
}).extend(SortSchema(['createdAt', 'name', 'size']).shape);

export type ListFileDto = z.infer<typeof ListFileSchema>;
