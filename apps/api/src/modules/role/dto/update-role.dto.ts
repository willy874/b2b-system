import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { PermissionKeySchema } from '@/modules/permission/dto/permission.dto';

import { RoleNameSchema } from './create-role.dto';

export const UpdateRoleSchema = defineSchema(
  'UpdateRoleRequest',
  z
    .object({
      name: RoleNameSchema.optional(),
      description: z.string().trim().max(500).nullable().optional(),
      /**
       * 樂觀鎖：編輯開始時看到的 `version`（必填）。與目前版本不同（別人已經改過）回 409 `ROLE_VERSION_CONFLICT`
       * （`details.current`）。要後寫者勝的腳本先讀一次目前的版本（ADR-0025 D3、D4）。
       */
      version: z.number().int().min(1),
    })
    // `version` 不是要改的欄位：只帶它等於什麼都沒改
    .refine(({ version: _version, ...fields }) => Object.keys(fields).length > 0, {
      message: 'at least one field is required',
    }),
);

/**
 * 差異語意：整批取代在兩人同時編輯時會互相覆寫。
 * 同一個權限不能同時出現在 `add` 與 `remove`：意圖不明，結果也會跟稽核對不上。
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
