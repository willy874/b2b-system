import type { PermissionKey } from '@/db/seeds/permissions';
import type { PlatformPermissionKey } from '@/db/seeds/platform-permissions';

export type { PermissionKey, PlatformPermissionKey };

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
  USER_RESET_MFA: 'user:resetMfa',
  USER_EXPORT: 'user:export',

  ROLE_CREATE: 'role:create',
  ROLE_READ: 'role:read',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',
  ROLE_GRANT_PERMISSION: 'role:grantPermission',

  PERMISSION_READ: 'permission:read',
  AUDIT_LOG_READ: 'auditLog:read',
  AUDIT_LOG_EXPORT: 'auditLog:export',
  SYSTEM_READ: 'system:read',
  SYSTEM_UPDATE: 'system:update',
  MFA_POLICY_READ: 'mfaPolicy:read',
  MFA_POLICY_UPDATE: 'mfaPolicy:update',

  APPROVAL_READ: 'approval:read',
  APPROVAL_REVIEW: 'approval:review',
  APPROVAL_OVERRIDE: 'approval:override',
  APPROVAL_FLOW_READ: 'approvalFlow:read',
  APPROVAL_FLOW_UPDATE: 'approvalFlow:update',

  ORG_UNIT_CREATE: 'orgUnit:create',
  ORG_UNIT_READ: 'orgUnit:read',
  ORG_UNIT_UPDATE: 'orgUnit:update',
  ORG_UNIT_DELETE: 'orgUnit:delete',

  FILE_CREATE: 'file:create',
  FILE_READ: 'file:read',
  FILE_UPDATE: 'file:update',
  FILE_DELETE: 'file:delete',
  FILE_ACCESS: 'file:access',
  FILE_SHARE: 'file:share',
  FILE_LIST_PERSONAL: 'file:listPersonal',

  JOB_READ: 'job:read',
  JOB_RETRY: 'job:retry',

  IDENTITY_PROVIDER_CREATE: 'identityProvider:create',
  IDENTITY_PROVIDER_READ: 'identityProvider:read',
  IDENTITY_PROVIDER_UPDATE: 'identityProvider:update',
  IDENTITY_PROVIDER_DELETE: 'identityProvider:delete',

  GROUP_CREATE: 'group:create',
  GROUP_READ: 'group:read',
  GROUP_UPDATE: 'group:update',
  GROUP_DELETE: 'group:delete',
  GROUP_ASSIGN_ROLE: 'group:assignRole',

  AUTHZ_EXPLAIN: 'authz:explain',

  SERVICE_ACCOUNT_CREATE: 'serviceAccount:create',
  SERVICE_ACCOUNT_READ: 'serviceAccount:read',
  SERVICE_ACCOUNT_UPDATE: 'serviceAccount:update',
  SERVICE_ACCOUNT_DELETE: 'serviceAccount:delete',

  WEBHOOK_CREATE: 'webhook:create',
  WEBHOOK_READ: 'webhook:read',
  WEBHOOK_UPDATE: 'webhook:update',
  WEBHOOK_DELETE: 'webhook:delete',

  TAG_CREATE: 'tag:create',
  TAG_UPDATE: 'tag:update',
  TAG_DELETE: 'tag:delete',

  NOTIFICATION_READ: 'notification:read',

  ANNOUNCEMENT_CREATE: 'announcement:create',
  ANNOUNCEMENT_READ: 'announcement:read',
  ANNOUNCEMENT_UPDATE: 'announcement:update',
  ANNOUNCEMENT_DELETE: 'announcement:delete',
  ANNOUNCEMENT_PUBLISH: 'announcement:publish',
} as const satisfies Record<string, PermissionKey>;
