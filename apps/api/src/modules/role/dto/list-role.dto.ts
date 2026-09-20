import { z } from 'zod';

import { PaginationSchema, SortSchema } from '@/core/http';

export const ListRoleSchema = PaginationSchema.extend({
  keyword: z.string().trim().max(100).optional(),
  isSystem: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
}).extend(SortSchema(['createdAt', 'name', 'slug']).shape);

export type ListRoleDto = z.infer<typeof ListRoleSchema>;

export const DeleteRoleSchema = z.object({
  force: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type DeleteRoleDto = z.infer<typeof DeleteRoleSchema>;

export const ListRoleUsersSchema = PaginationSchema;
export type ListRoleUsersDto = z.infer<typeof ListRoleUsersSchema>;
