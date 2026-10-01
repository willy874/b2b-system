import { z } from 'zod';

import { PaginationSchema, SortSchema } from '@/core/http';

export const ListGroupSchema = PaginationSchema.extend({
  keyword: z.string().trim().max(100).optional(),
}).extend(SortSchema(['createdAt', 'name', 'memberCount', 'roleCount']).shape);

export type ListGroupDto = z.infer<typeof ListGroupSchema>;

export const ListGroupMembersSchema = PaginationSchema;
export type ListGroupMembersDto = z.infer<typeof ListGroupMembersSchema>;
