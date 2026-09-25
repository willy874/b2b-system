import type { PermissionKey } from '@/db/seeds/permissions';

export type { PermissionKey };

/**
 * `@RequirePermissions(PERMISSION.ROLE_UPDATE)` 用的具名常數。
 * 直接寫字串也能編譯（型別是字面量聯集），但常數讓改名時能被編譯器抓到。
 */
export const PERMISSION = {
  USER_CREATE: 'user:create',
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_ASSIGN_ROLE: 'user:assignRole',
  USER_RESET_PASSWORD: 'user:resetPassword',

  ROLE_CREATE: 'role:create',
  ROLE_READ: 'role:read',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',
  ROLE_GRANT_PERMISSION: 'role:grantPermission',

  PERMISSION_READ: 'permission:read',
  AUDIT_LOG_READ: 'auditLog:read',
  SYSTEM_READ: 'system:read',
  SYSTEM_UPDATE: 'system:update',

  APPROVAL_READ: 'approval:read',
  APPROVAL_REVIEW: 'approval:review',
} as const satisfies Record<string, PermissionKey>;
