import { z } from 'zod';

import { PaginationSchema, SortSchema } from '@/core/http';
import { TagIdsFilterSchema } from '@/modules/tag/dto/tag.dto';

/** 重複 key 的查詢參數（`?status=a&status=b`）在 express 會是陣列。 */
const multiValue = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => {
    if (value === undefined) return undefined;
    return Array.isArray(value) ? value : [value];
  }, z.array(schema).optional());

export const ListUserSchema = PaginationSchema.extend({
  keyword: z.string().trim().max(100).optional(),
  status: multiValue(z.enum(['pending', 'active', 'inactive', 'locked'])),
  roleId: multiValue(z.string().uuid()),
  /** 貼了其中任一個標籤（docs/adr/0032-tags.md D6）。 */
  tagId: TagIdsFilterSchema,
}).extend(SortSchema(['createdAt', 'email', 'displayName', 'lastLoginAt']).shape);

export type ListUserDto = z.infer<typeof ListUserSchema>;
