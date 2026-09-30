import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { PermissionKeySchema } from '@/modules/permission/dto/permission.dto';

/**
 * 角色名稱：Unicode 正規化成 NFC，組合方式不同的「é」才不會被當成兩個名稱
 * （唯一性另外不分大小寫）。
 */
export const RoleNameSchema = z.string().trim().normalize('NFC').min(1).max(64);

export const CreateRoleSchema = defineSchema(
  'CreateRoleRequest',
  z.object({
    name: RoleNameSchema,
    description: z.string().trim().max(500).optional(),
    permissionKeys: z.array(PermissionKeySchema).max(100).default([]),
  }),
);

export const DuplicateRoleSchema = defineSchema(
  'DuplicateRoleRequest',
  z.object({ name: RoleNameSchema.optional() }),
);

export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;
export type DuplicateRoleDto = z.infer<typeof DuplicateRoleSchema>;
