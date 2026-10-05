import type { ChipTone } from '@b2b-system/ui/Chip';

import type {
  PlatformAdmin,
  PlatformAdminPasswordLink,
  UpdatePlatformAdminRequest,
} from '@/shared/api-sdk';

type PlatformAdminRole = PlatformAdmin['role'];
type PlatformAdminStatus = PlatformAdmin['status'];
export type EditablePlatformAdminStatus = NonNullable<UpdatePlatformAdminRequest['status']>;

/** 角色依權限由大到小排列（新增、編輯的下拉選單照這個順序）。 */
export const PLATFORM_ADMIN_ROLES = [
  'super-admin',
  'operator',
  'auditor',
] as const satisfies readonly PlatformAdminRole[];

export const PLATFORM_ADMIN_ROLE_LABEL_KEY = {
  'super-admin': 'platformAdmin.role.superAdmin',
  operator: 'platformAdmin.role.operator',
  auditor: 'platformAdmin.role.auditor',
} as const satisfies Record<PlatformAdminRole, string>;

export const PLATFORM_ADMIN_STATUS_LABEL_KEY = {
  active: 'platformAdmin.status.active',
  inactive: 'platformAdmin.status.inactive',
  locked: 'platformAdmin.status.locked',
  pending: 'platformAdmin.status.pending',
} as const satisfies Record<PlatformAdminStatus, string>;

/** 狀態的 Chip 語氣（顏色走 design token，由 `Chip` 的 `tone` 決定）。 */
export const PLATFORM_ADMIN_STATUS_TONE = {
  active: 'success',
  inactive: 'neutral',
  locked: 'danger',
  pending: 'warning',
} as const satisfies Record<PlatformAdminStatus, ChipTone>;

/** 角色的 Chip 語氣：能改資料的角色以 brand 標出。 */
export const PLATFORM_ADMIN_ROLE_TONE = {
  'super-admin': 'brand',
  operator: 'neutral',
  auditor: 'neutral',
} as const satisfies Record<PlatformAdminRole, ChipTone>;

/** 編輯時能設定的狀態（`locked` 由登入失敗觸發，改回 `active` 即解鎖；`pending` 等本人啟用）。 */
export const EDITABLE_PLATFORM_ADMIN_STATUSES = [
  'active',
  'inactive',
] as const satisfies readonly EditablePlatformAdminStatus[];

export const PASSWORD_LINK_SUCCESS_KEY = {
  activation: 'platformAdmin.passwordLink.activationSent',
  passwordReset: 'platformAdmin.passwordLink.passwordResetSent',
} as const satisfies Record<PlatformAdminPasswordLink['purpose'], string>;
