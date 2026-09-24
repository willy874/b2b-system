import { z } from 'zod';

export const UserSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).catch(0),
  limit: z.coerce.number().int().min(1).max(200).default(20).catch(20),
  keyword: z.string().trim().optional().catch(undefined),
  status: z.enum(['pending', 'active', 'inactive', 'locked']).optional().catch(undefined),
  sortBy: z
    .enum(['createdAt', 'email', 'displayName', 'lastLoginAt'])
    .default('createdAt')
    .catch('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc').catch('desc'),
});

export type UserSearchQuery = z.infer<typeof UserSearchQuerySchema>;
