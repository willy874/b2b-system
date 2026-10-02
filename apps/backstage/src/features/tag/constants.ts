import type { TagScope } from '@/apis/tag/types';
import { TenantFeature } from '@/shared/api-sdk';
import type { Tag } from '@/shared/api-sdk';

type TagColor = Tag['color'];

/** 標籤組的分頁名稱（字面量 key，docs/conventions/06-literal-strings.md）。 */
export const TAG_SCOPE_LABEL_KEY = {
  file: 'tagAdmin.scope.file',
  user: 'tagAdmin.scope.user',
} as const satisfies Record<TagScope, string>;

export const TAG_SCOPE_DESCRIPTION_KEY = {
  file: 'tagAdmin.scope.fileDescription',
  user: 'tagAdmin.scope.userDescription',
} as const satisfies Record<TagScope, string>;

/** 標籤組跟著哪個可啟用的 feature（docs/adr/0032-tags.md D12）；常駐的不列。 */
export const TAG_SCOPE_FEATURE: Partial<Record<TagScope, TenantFeature>> = {
  file: TenantFeature.file,
};

export const TAG_COLORS = [
  'neutral',
  'brand',
  'success',
  'warning',
  'danger',
] as const satisfies readonly TagColor[];

export const TAG_COLOR_LABEL_KEY = {
  neutral: 'tagAdmin.color.neutral',
  brand: 'tagAdmin.color.brand',
  success: 'tagAdmin.color.success',
  warning: 'tagAdmin.color.warning',
  danger: 'tagAdmin.color.danger',
} as const satisfies Record<TagColor, string>;

/** 名稱長度上限；與後端的 `TAG_NAME_MAX_LENGTH` 一致。 */
export const TAG_NAME_MAX_LENGTH = 50;
