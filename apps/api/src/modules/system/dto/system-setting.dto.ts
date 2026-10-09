import { z } from 'zod';

import { SettingCategory } from '@/core/settings';
import { defineSchema } from '@/core/validation';

/** 設定只有純量（`core/settings` 的 `SettingValue`）。 */
export const SettingValueSchema = z.union([z.string().max(1000), z.number(), z.boolean()]);

const SettingKeySchema = z.string().trim().min(1).max(100);

/** 一次最多改幾個 key：設定頁一個分類一次送出。 */
const MAX_CHANGES = 50;

export const SystemSettingSchema = defineSchema(
  'SystemSetting',
  z.object({
    key: z.string(),
    category: z.enum([
      SettingCategory.GENERAL,
      SettingCategory.AUTH,
      SettingCategory.FILE,
      SettingCategory.TRASH,
      SettingCategory.REVISION,
      SettingCategory.NOTIFICATION,
      SettingCategory.DATA_TRANSFER,
      SettingCategory.GALLERY,
    ]),
    type: z.enum(['string', 'number', 'boolean']),
    /** 生效值：有覆寫就是覆寫值，否則是預設值。 */
    value: SettingValueSchema,
    defaultValue: SettingValueSchema,
    isOverridden: z.boolean(),
    isPublic: z.boolean(),
    /** 數值的允許範圍（取自定義的 schema）；前端表單用它先擋。 */
    minimum: z.number().nullable(),
    maximum: z.number().nullable(),
    /** 覆寫值最後修改的時間；沒有覆寫時為 `null`。 */
    updatedAt: z.string().nullable(),
  }),
);

export const SystemSettingListSchema = defineSchema(
  'SystemSettingList',
  z.object({ items: z.array(SystemSettingSchema) }),
);

export const UpdateSystemSettingsSchema = defineSchema(
  'UpdateSystemSettingsRequest',
  z.object({
    /** key → 新值；`null` 代表還原預設（刪掉覆寫值）。 */
    values: z
      .record(SettingKeySchema, SettingValueSchema.nullable())
      .refine((values) => Object.keys(values).length > 0, { message: 'values must not be empty' })
      .refine((values) => Object.keys(values).length <= MAX_CHANGES, {
        message: `at most ${MAX_CHANGES} keys`,
      }),
  }),
);

/** 公開設定：key → 生效值。未登入也讀得到，只包含定義上標為公開的設定。 */
export const PublicSystemSettingsSchema = defineSchema(
  'PublicSystemSettings',
  z.object({ values: z.record(z.string(), SettingValueSchema) }),
);

export type SystemSettingDto = z.infer<typeof SystemSettingSchema>;
export type SystemSettingListDto = z.infer<typeof SystemSettingListSchema>;
export type UpdateSystemSettingsDto = z.infer<typeof UpdateSystemSettingsSchema>;
export type PublicSystemSettingsDto = z.infer<typeof PublicSystemSettingsSchema>;
