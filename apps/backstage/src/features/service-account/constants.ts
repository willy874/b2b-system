import type { ChipTone } from '@/components/Chip';
import type { ServiceAccount } from '@/shared/api-sdk';

type ServiceAccountStatus = ServiceAccount['status'];

/** 狀態的文字（字面量 key，docs/conventions/06-literal-strings.md）。 */
export const SERVICE_ACCOUNT_STATUS_LABEL_KEY = {
  active: 'serviceAccount.status.active',
  inactive: 'serviceAccount.status.inactive',
} as const satisfies Record<ServiceAccountStatus, string>;

export const SERVICE_ACCOUNT_STATUS_TONE = {
  active: 'success',
  inactive: 'neutral',
} as const satisfies Record<ServiceAccountStatus, ChipTone>;

/** 服務帳號的 API token 到期上限（天，docs/architecture/06-external-api.md §9.2 D8）；租戶設定更短時由後端擋下。 */
export const SERVICE_ACCOUNT_TOKEN_MAX_DAYS = 365;

/** 一次最多持有幾個角色；與後端的 `roleIds.max(20)` 一致。 */
export const MAX_SERVICE_ACCOUNT_ROLES = 20;
