import type { PlatformAdminRole } from '../platform/schema';

/**
 * 平台的權限目錄（docs/architecture/05-tenancy.md §10.2 D5）：apps/platform 的平台管理者用，與租戶的目錄
 * （`permissions.ts`）互不相干。**唯一事實來源是 `docs/architecture/iam/02-permission-catalog.md` §8**；改這裡必須同時改文件。
 *
 * 平台的權限不寫進資料庫：角色固定三種（`platform_admins.role`），對照表就在這裡。
 */
export const PLATFORM_PERMISSION_SEED = [
  // resource, action, i18n key
  ['tenant', 'read', 'permission.tenant.read'],
  ['tenant', 'create', 'permission.tenant.create'],
  ['tenant', 'update', 'permission.tenant.update'],
  ['tenant', 'delete', 'permission.tenant.delete'],
  ['platformAdmin', 'read', 'permission.platformAdmin.read'],
  ['platformAdmin', 'create', 'permission.platformAdmin.create'],
  ['platformAdmin', 'update', 'permission.platformAdmin.update'],
  ['platformAuditLog', 'read', 'permission.platformAuditLog.read'],
  ['platformJob', 'read', 'permission.platformJob.read'],
  ['platformJob', 'retry', 'permission.platformJob.retry'],
  ['featureFlag', 'read', 'permission.featureFlag.read'],
  ['featureFlag', 'update', 'permission.featureFlag.update'],
  // MFA 方式的平台開關（docs/architecture/backend/21-mfa.md §5）；update 只有 super-admin
  ['mfaMethod', 'read', 'permission.mfaMethod.read'],
  ['mfaMethod', 'update', 'permission.mfaMethod.update'],
] as const;

type PlatformSeedRow = (typeof PLATFORM_PERMISSION_SEED)[number];
export type PlatformPermissionKey = `${PlatformSeedRow[0]}:${PlatformSeedRow[1]}`;

export const ALL_PLATFORM_PERMISSION_KEYS: readonly PlatformPermissionKey[] =
  PLATFORM_PERMISSION_SEED.map(
    ([resource, action]) => `${resource}:${action}` as PlatformPermissionKey,
  );

/**
 * 角色 → 權限。super-admin 是全集；operator 管租戶（不能刪除）與背景工作、看得到管理者與稽核；auditor 唯讀。
 * 只有 super-admin 能管理平台管理者：不必另外做反提權（operator 不能把自己升成 super-admin）。
 */
export const PLATFORM_ROLE_PERMISSIONS: Record<
  PlatformAdminRole,
  readonly PlatformPermissionKey[]
> = {
  'super-admin': ALL_PLATFORM_PERMISSION_KEYS,
  operator: [
    'tenant:read',
    'tenant:create',
    'tenant:update',
    'platformAdmin:read',
    'platformAuditLog:read',
    'platformJob:read',
    'platformJob:retry',
    // 緊急關閉 flag 要讓值班的人做得到（docs/architecture/05-tenancy.md §11.2 D8）
    'featureFlag:read',
    'featureFlag:update',
    'mfaMethod:read',
  ],
  auditor: [
    'tenant:read',
    'platformAdmin:read',
    'platformAuditLog:read',
    'platformJob:read',
    'featureFlag:read',
    'mfaMethod:read',
  ],
};
