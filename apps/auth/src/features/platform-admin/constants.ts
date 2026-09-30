import type { PlatformAdminPasswordLink } from '@/shared/api-sdk';
import type { PlatformAdmin, UpdatePlatformAdminRequest } from '@/shared/api-sdk';

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

/** 狀態點的顏色走 design token（CLAUDE.md 前端規則 6）。 */
export const PLATFORM_ADMIN_STATUS_DOT_CLASS = {
  active: 'bg-[var(--color-success)]',
  inactive: 'bg-[var(--color-fg-muted)]',
  locked: 'bg-[var(--color-danger)]',
  pending: 'bg-[var(--color-warning)]',
} as const satisfies Record<PlatformAdminStatus, string>;

/** 編輯時能設定的狀態（`locked` 由登入失敗觸發，改回 `active` 即解鎖；`pending` 等本人啟用）。 */
export const EDITABLE_PLATFORM_ADMIN_STATUSES = [
  'active',
  'inactive',
] as const satisfies readonly EditablePlatformAdminStatus[];

export const PASSWORD_LINK_SUCCESS_KEY = {
  activation: 'platformAdmin.passwordLink.activationSent',
  passwordReset: 'platformAdmin.passwordLink.passwordResetSent',
} as const satisfies Record<PlatformAdminPasswordLink['purpose'], string>;
