import type { ChipTone } from '@/components/Chip';
import type { ApprovalStatus, ApprovalType } from '@/shared/api-sdk';

/**
 * 狀態 → 語系鍵。key 以完整字面量寫在表裡（docs/conventions/06-literal-strings.md §3.1）；
 * `satisfies` 讓後端新增狀態或類型時編譯失敗，而不是畫面上出現原始 key。
 */
export const APPROVAL_STATUS_LABEL_KEY = {
  pending: 'approval.status.pending',
  approved: 'approval.status.approved',
  rejected: 'approval.status.rejected',
} as const satisfies Record<ApprovalStatus, string>;

export const APPROVAL_STATUS_TONE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
} as const satisfies Record<ApprovalStatus, ChipTone>;

export const APPROVAL_TYPE_LABEL_KEY = {
  'user.register': 'approval.type.userRegister',
} as const satisfies Record<ApprovalType, string>;
