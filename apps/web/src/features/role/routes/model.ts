import { z } from 'zod';

/** `.catch()` 而非 `.default()`：使用者手改網址成 ?limit=abc 時退回預設值，不變成錯誤頁。 */
export const RoleSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(200).catch(20),
  keyword: z.string().trim().optional().catch(undefined),
  sortBy: z.enum(['createdAt', 'name', 'slug']).catch('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).catch('desc'),
});

export type RoleSearchQuery = z.infer<typeof RoleSearchQuerySchema>;

export const DEFAULT_ROLE_SEARCH: RoleSearchQuery = {
  offset: 0,
  limit: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
};
