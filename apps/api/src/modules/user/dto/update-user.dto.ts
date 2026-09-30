import { z } from 'zod';

import { defineSchema, uniqueItems } from '@/core/validation';

export const UpdateUserSchema = defineSchema(
  'UpdateUserRequest',
  z
    .object({
      username: z.string().trim().min(3).max(50).nullable().optional(),
      displayName: z.string().trim().min(1).max(100).optional(),
      // `pending` 只能由建立帳號產生、靠啟用信離開：改回 pending 的人沒有啟用 token，再也登入不了
      status: z.enum(['active', 'inactive']).optional(),
      locale: z.string().max(10).optional(),
      timezone: z.string().max(64).optional(),
      /**
       * 樂觀鎖：編輯開始時看到的 `version`。與目前版本不同（別人已經改過）回 409 `USER_VERSION_CONFLICT`
       * （`details.current`）；不帶則後寫者勝（ADR-0025 D3、D4：R1 選填，之後改必填）。
       */
      version: z.number().int().min(1).optional(),
    })
    // `version` 不是要改的欄位：只帶它等於什麼都沒改
    .refine(({ version: _version, ...fields }) => Object.keys(fields).length > 0, {
      message: 'at least one field is required',
    }),
);

export const ReplaceUserRolesSchema = defineSchema(
  'ReplaceUserRolesRequest',
  z.object({
    roleIds: uniqueItems(z.array(z.string().uuid()).max(20)),
    /**
     * 草稿所依據的角色（編輯開始時伺服器上的角色）。有帶時，與目前的角色不同就回 409 `USER_ROLES_CONFLICT`，
     * 不會蓋掉別人剛做的變更。
     */
    expectedRoleIds: z.array(z.string().uuid()).max(100).optional(),
  }),
);

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
export type ReplaceUserRolesDto = z.infer<typeof ReplaceUserRolesSchema>;
