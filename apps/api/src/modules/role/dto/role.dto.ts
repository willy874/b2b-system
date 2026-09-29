import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { PermissionSchema, PermissionScopeSchema } from '@/modules/permission/dto/permission.dto';

export const RoleSchema = defineSchema(
  'Role',
  z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    scope: PermissionScopeSchema,
    permissionCount: z.number().int(),
    userCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const RolePermissionsSchema = defineSchema(
  'RolePermissions',
  z.object({ permissions: z.array(PermissionSchema) }),
);

export const RoleHolderSchema = defineSchema(
  'RoleHolder',
  z.object({
    id: z.string().uuid(),
    email: z.string(),
    displayName: z.string(),
    status: z.enum(['pending', 'active', 'inactive', 'locked']),
  }),
);

export type RoleDto = z.infer<typeof RoleSchema>;
