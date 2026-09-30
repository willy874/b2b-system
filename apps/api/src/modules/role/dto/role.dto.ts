import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import {
  EffectivePermissionSchema,
  PermissionSchema,
} from '@/modules/permission/dto/permission.dto';

export const RoleSchema = defineSchema(
  'Role',
  z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    permissionCount: z.number().int(),
    userCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const RolePermissionsSchema = defineSchema(
  'RolePermissions',
  z.object({
    /** 明確授予的權限（`role_permissions`）。 */
    permissions: z.array(PermissionSchema),
    /** 實際持有的鍵：明確的 ＋ 權限依賴樹帶出的（docs/rbac/02-permission-catalog.md §9）。 */
    effective: z.array(EffectivePermissionSchema),
    /** super-admin 角色：隱含全集、不能改權限。 */
    isSuperAdmin: z.boolean(),
  }),
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
