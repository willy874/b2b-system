import type { ChipTone } from '@b2b-system/ui/Chip';

import type { ApiToken } from '@/shared/api-sdk';

type ApiTokenStatus = ApiToken['status'];

/** 狀態的文字（字面量 key，docs/coding-standards/06-literal-strings.md）。 */
export const API_TOKEN_STATUS_LABEL_KEY = {
  active: 'apiToken.status.active',
  expired: 'apiToken.status.expired',
  revoked: 'apiToken.status.revoked',
  invalidated: 'apiToken.status.invalidated',
} as const satisfies Record<ApiTokenStatus, string>;

export const API_TOKEN_STATUS_TONE = {
  active: 'success',
  expired: 'neutral',
  revoked: 'neutral',
  invalidated: 'warning',
} as const satisfies Record<ApiTokenStatus, ChipTone>;

/** 到期天數的選項；超過上限（個人 90、服務帳號 365；租戶可調短）的不提供。 */
export const API_TOKEN_LIFETIME_OPTIONS = [7, 30, 90, 180, 365] as const;
