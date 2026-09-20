import { z } from 'zod';

export const UserSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(200).catch(20),
  keyword: z.string().trim().optional().catch(undefined),
  status: z.enum(['pending', 'active', 'inactive', 'locked']).optional().catch(undefined),
  sortBy: z.enum(['createdAt', 'email', 'displayName', 'lastLoginAt']).catch('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).catch('desc'),
});

export type UserSearchQuery = z.infer<typeof UserSearchQuerySchema>;

export const DEFAULT_USER_SEARCH: UserSearchQuery = {
  offset: 0,
  limit: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
};
