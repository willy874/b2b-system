import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import {
  PermissionKeySchema,
  PermissionScopeSchema,
} from '@/modules/permission/dto/permission.dto';

export const CreateRoleSchema = defineSchema(
  'CreateRoleRequest',
  z.object({
    name: z.string().trim().min(1).max(64),
    description: z.string().trim().max(500).optional(),
    /** 建立後不可變；權限鍵必須同範圍（docs/adr/0018-workspace-tenancy.md D3）。 */
    scope: PermissionScopeSchema.default('platform'),
    permissionKeys: z.array(PermissionKeySchema).max(100).default([]),
  }),
);

export const DuplicateRoleSchema = defineSchema(
  'DuplicateRoleRequest',
  z.object({ name: z.string().trim().min(1).max(64).optional() }),
);

export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;
export type DuplicateRoleDto = z.infer<typeof DuplicateRoleSchema>;
