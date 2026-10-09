import type { PermissionKey } from '@/core/permission';
import type { PlatformProfile } from '@/shared/api-sdk';

type PlatformRole = PlatformProfile['admin']['role'];

export const PLATFORM_ROLE_LABEL_KEY = {
  'super-admin': 'account.role.superAdmin',
  operator: 'account.role.operator',
  auditor: 'account.role.auditor',
} as const satisfies Record<PlatformRole, string>;

/**
 * 平台的權限名稱（docs/architecture/iam/02-permission-catalog.md §8.1）。平台的權限不寫進資料庫，後端不回 `nameI18nKey`，
 * 所以在這裡以完整字面量對照（docs/coding-standards/06-literal-strings.md §3.1）；新增權限鍵時編譯會失敗。
 */
export const PLATFORM_PERMISSION_LABEL_KEY = {
  'tenant:read': 'permission.tenant.read',
  'tenant:create': 'permission.tenant.create',
  'tenant:update': 'permission.tenant.update',
  'tenant:delete': 'permission.tenant.delete',
  'platformAdmin:read': 'permission.platformAdmin.read',
  'platformAdmin:create': 'permission.platformAdmin.create',
  'platformAdmin:update': 'permission.platformAdmin.update',
  'platformAdmin:resetMfa': 'permission.platformAdmin.resetMfa',
  'platformAuditLog:read': 'permission.platformAuditLog.read',
  'platformJob:read': 'permission.platformJob.read',
  'platformJob:retry': 'permission.platformJob.retry',
  'featureFlag:read': 'permission.featureFlag.read',
  'featureFlag:update': 'permission.featureFlag.update',
  'mfaMethod:read': 'permission.mfaMethod.read',
  'mfaMethod:update': 'permission.mfaMethod.update',
  'cdn:read': 'permission.cdn.read',
  'cdn:update': 'permission.cdn.update',
  'cdn:purge': 'permission.cdn.purge',
  'cdn:purgeAll': 'permission.cdn.purgeAll',
} as const satisfies Record<PermissionKey, string>;
