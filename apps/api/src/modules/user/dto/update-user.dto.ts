import { z } from 'zod';

import { TimeZoneSchema } from '@/core/settings';
import { defineSchema, uniqueItems } from '@/core/validation';
import { ImageCropSchema } from '@/modules/image/dto/image.dto';

export const UpdateUserSchema = defineSchema(
  'UpdateUserRequest',
  z
    .object({
      username: z.string().trim().min(3).max(50).nullable().optional(),
      displayName: z.string().trim().min(1).max(100).optional(),
      // `pending` 只能由建立帳號產生、靠啟用信離開：改回 pending 的人沒有啟用 token，再也登入不了
      status: z.enum(['active', 'inactive']).optional(),
      locale: z.string().max(10).optional(),
      timezone: TimeZoneSchema.optional(),
      /**
       * 換頭像：自己剛上傳（或從其他來源選來）、還沒被使用的圖片資產 id；`null` 是拿掉頭像
       * （docs/architecture/backend/25-image.md §15.8）。
       */
      avatarImageId: z.string().uuid().nullable().optional(),
      /** 頭像的裁切（比例，0～1）；只帶它是重新裁切目前的頭像，不必重傳。 */
      avatarCrop: ImageCropSchema.optional(),
      /**
       * 樂觀鎖：編輯開始時看到的 `version`（必填）。與目前版本不同（別人已經改過）回 409 `USER_VERSION_CONFLICT`
       * （`details.current`）。要後寫者勝的腳本先讀一次目前的版本（docs/architecture/backend/14-revisions.md §9.2 D3、D4）。
       */
      version: z.number().int().min(1),
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
     * 草稿所依據的角色（編輯開始時伺服器上的角色，必填）。與目前的角色不同就回 409 `USER_ROLES_CONFLICT`，
     * 不會蓋掉別人剛做的變更（docs/architecture/backend/14-revisions.md §9.2 D4）。
     */
    expectedRoleIds: z.array(z.string().uuid()).max(100),
  }),
);

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
export type ReplaceUserRolesDto = z.infer<typeof ReplaceUserRolesSchema>;
