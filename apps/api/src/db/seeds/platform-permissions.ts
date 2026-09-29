import type { PlatformAdminRole } from '../platform/schema';

/**
 * 平台的權限目錄（docs/adr/0020-physical-tenant-isolation.md D5）：apps/auth 的平台管理者用，與租戶的目錄
 * （`permissions.ts`）互不相干。**唯一事實來源是 `docs/rbac/02-permission-catalog.md` §8**；改這裡必須同時改文件。
 *
 * 平台的權限不寫進資料庫：角色固定三種（`platform_admins.role`），對照表就在這裡。
 */
export const PLATFORM_PERMISSION_SEED = [
  // resource, action, i18n key
  ['tenant', 'read', 'permission.tenant.read'],
  ['tenant', 'create', 'permission.tenant.create'],
  ['tenant', 'update', 'permission.tenant.update'],
  ['tenant', 'delete', 'permission.tenant.delete'],
] as const;

type PlatformSeedRow = (typeof PLATFORM_PERMISSION_SEED)[number];
export type PlatformPermissionKey = `${PlatformSeedRow[0]}:${PlatformSeedRow[1]}`;

export const ALL_PLATFORM_PERMISSION_KEYS: readonly PlatformPermissionKey[] =
  PLATFORM_PERMISSION_SEED.map(
    ([resource, action]) => `${resource}:${action}` as PlatformPermissionKey,
  );

/** 角色 → 權限。super-admin 是全集；operator 管租戶但不能刪除；auditor 唯讀。 */
export const PLATFORM_ROLE_PERMISSIONS: Record<
  PlatformAdminRole,
  readonly PlatformPermissionKey[]
> = {
  'super-admin': ALL_PLATFORM_PERMISSION_KEYS,
  operator: ['tenant:read', 'tenant:create', 'tenant:update'],
  auditor: ['tenant:read'],
};
