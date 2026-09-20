import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { PermissionKeySchema } from '@/modules/permission/dto/permission.dto';

export const UpdateRoleSchema = defineSchema(
  'UpdateRoleRequest',
  z
    .object({
      name: z.string().trim().min(1).max(64).optional(),
      description: z.string().trim().max(500).nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'at least one field is required',
    }),
);

/** 差異語意：整批取代在兩人同時編輯時會互相覆寫。 */
export const UpdateRolePermissionsSchema = defineSchema(
  'UpdateRolePermissionsRequest',
  z.object({
    add: z.array(PermissionKeySchema).max(100).default([]),
    remove: z.array(PermissionKeySchema).max(100).default([]),
  }),
);

export type UpdateRoleDto = z.infer<typeof UpdateRoleSchema>;
export type UpdateRolePermissionsDto = z.infer<typeof UpdateRolePermissionsSchema>;
