import type { UpdateFeatureFlagRequest } from '@/shared/api-sdk';

/** 全平台層的三種狀態（docs/architecture/05-tenancy.md §11.2 D3）；`default` = 沒有覆寫。 */
export type FeatureFlagGlobalChoice = UpdateFeatureFlagRequest['state'];

export const FEATURE_FLAG_GLOBAL_CHOICES = [
  'default',
  'on',
  'off',
] as const satisfies readonly FeatureFlagGlobalChoice[];

export const FEATURE_FLAG_GLOBAL_LABEL_KEY = {
  default: 'featureFlag.global.default',
  on: 'featureFlag.global.on',
  off: 'featureFlag.global.off',
} as const satisfies Record<FeatureFlagGlobalChoice, string>;

export const FEATURE_FLAG_GLOBAL_CONFIRM_KEY = {
  default: 'featureFlag.confirm.default',
  on: 'featureFlag.confirm.on',
  off: 'featureFlag.confirm.off',
} as const satisfies Record<FeatureFlagGlobalChoice, string>;
