import { z } from 'zod';

import { FEATURE_FLAG_GLOBAL_STATES } from '@/core/feature-flags';
import { defineSchema } from '@/core/validation';

/** 全平台層的覆寫：沒有 = 不覆寫（docs/architecture/05-tenancy.md §11.2 D2、D3）。 */
export const FeatureFlagGlobalStateSchema = defineSchema(
  'FeatureFlagGlobalState',
  z.enum(FEATURE_FLAG_GLOBAL_STATES),
);

/** 平台管理者看到的 flag：目錄的定義、全平台覆寫、覆寫它的租戶數（D8）。 */
export const FeatureFlagSchema = defineSchema(
  'FeatureFlag',
  z.object({
    key: z.string(),
    description: z.string(),
    defaultEnabled: z.boolean(),
    owner: z.string(),
    /** 預計移除的日期（`YYYY-MM-DD`）。 */
    removeBy: z.string(),
    globalState: FeatureFlagGlobalStateSchema.nullable(),
    /** 租戶層把它覆寫成開、關的租戶數（未刪除的租戶）。 */
    tenantOverrides: z.object({ on: z.number().int(), off: z.number().int() }),
  }),
);

export const FeatureFlagListSchema = defineSchema(
  'FeatureFlagList',
  z.object({ items: z.array(FeatureFlagSchema) }),
);

export const UpdateFeatureFlagSchema = defineSchema(
  'UpdateFeatureFlagRequest',
  z.object({
    /** `default` = 移除全平台覆寫；`on` = 全面開放；`off` = 緊急關閉（蓋過租戶層）。 */
    state: z.enum(['default', ...FEATURE_FLAG_GLOBAL_STATES]),
  }),
);

export type FeatureFlagDto = z.infer<typeof FeatureFlagSchema>;
export type FeatureFlagListDto = z.infer<typeof FeatureFlagListSchema>;
export type UpdateFeatureFlagDto = z.infer<typeof UpdateFeatureFlagSchema>;
