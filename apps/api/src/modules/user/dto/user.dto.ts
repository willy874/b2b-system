import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { TagSummarySchema } from '@/modules/tag/dto/tag.dto';

export const UserStatusSchema = defineSchema(
  'UserStatus',
  z.enum(['pending', 'active', 'inactive', 'locked']),
);

export const RoleSummarySchema = defineSchema(
  'RoleSummary',
  z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    isSystem: z.boolean(),
  }),
);

export const UserSchema = defineSchema(
  'User',
  z.object({
    id: z.string().uuid(),
    email: z.string(),
    username: z.string().nullable(),
    displayName: z.string(),
    status: UserStatusSchema,
    roles: z.array(RoleSummarySchema),
    /** 貼著的標籤（`user` 標籤組，docs/adr/0032-tags.md D6）。 */
    tags: z.array(TagSummarySchema),
    locale: z.string(),
    timezone: z.string(),
    lastLoginAt: z.string().nullable(),
    lockedUntil: z.string().nullable(),
    /** 樂觀鎖版本：`PATCH` 時帶上（ADR-0025 D3）。 */
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const UserRolesSchema = defineSchema(
  'UserRoles',
  z.object({ roles: z.array(RoleSummarySchema) }),
);

export type UserDto = z.infer<typeof UserSchema>;
export type RoleSummaryDto = z.infer<typeof RoleSummarySchema>;
