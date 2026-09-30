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

/**
 * 差異語意：整批取代在兩人同時編輯時會互相覆寫。
 * 同一個權限不能同時出現在 `add` 與 `remove`：意圖不明，結果也會跟稽核對不上（docs/issues/03-edge-cases.md EDGE-18）。
 */
export const UpdateRolePermissionsSchema = defineSchema(
  'UpdateRolePermissionsRequest',
  z
    .object({
      add: z.array(PermissionKeySchema).max(100).default([]),
      remove: z.array(PermissionKeySchema).max(100).default([]),
    })
    .refine(({ add, remove }) => !add.some((key) => remove.includes(key)), {
      message: 'a permission cannot be both added and removed',
      path: ['remove'],
    }),
);

export type UpdateRoleDto = z.infer<typeof UpdateRoleSchema>;
export type UpdateRolePermissionsDto = z.infer<typeof UpdateRolePermissionsSchema>;
