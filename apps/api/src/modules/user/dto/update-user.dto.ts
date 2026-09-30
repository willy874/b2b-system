import { z } from 'zod';

import { defineSchema, uniqueItems } from '@/core/validation';

export const UpdateUserSchema = defineSchema(
  'UpdateUserRequest',
  z
    .object({
      username: z.string().trim().min(3).max(50).nullable().optional(),
      displayName: z.string().trim().min(1).max(100).optional(),
      status: z.enum(['pending', 'active', 'inactive']).optional(),
      locale: z.string().max(10).optional(),
      timezone: z.string().max(64).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'at least one field is required',
    }),
);

export const ReplaceUserRolesSchema = defineSchema(
  'ReplaceUserRolesRequest',
  z.object({ roleIds: uniqueItems(z.array(z.string().uuid()).max(20)) }),
);

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
export type ReplaceUserRolesDto = z.infer<typeof ReplaceUserRolesSchema>;
