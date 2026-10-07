import type { ChipTone } from '@b2b-system/ui/Chip';

import type { UserStatus } from '@/shared/api-sdk';

/**
 * 使用者狀態 → 語系鍵。key 以完整字面量寫在表裡（docs/coding-standards/06-literal-strings.md §3.1）；
 * `satisfies` 讓後端新增狀態時編譯失敗，而不是畫面上出現原始 key。
 */
export const USER_STATUS_LABEL_KEY = {
  pending: 'user.status.pending',
  active: 'user.status.active',
  inactive: 'user.status.inactive',
  locked: 'user.status.locked',
} as const satisfies Record<UserStatus, string>;

/** 使用者狀態 → 色調。列表與詳情共用，同一個狀態不會在兩處顯示不同顏色。 */
export const USER_STATUS_TONE = {
  active: 'success',
  pending: 'warning',
  inactive: 'neutral',
  locked: 'danger',
} as const satisfies Record<UserStatus, ChipTone>;
