import { SetMetadata } from '@nestjs/common';

import type { PermissionKey, PlatformPermissionKey } from '../types';

export const REQUIRED_PERMISSIONS = 'rbac:requiredPermissions';

export interface PermissionRequirement {
  keys: PermissionKey[];
  match: 'every' | 'some';
}

export const RequirePermissions = (...keys: PermissionKey[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, { keys, match: 'every' } satisfies PermissionRequirement);

export const RequireAnyPermission = (...keys: PermissionKey[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, { keys, match: 'some' } satisfies PermissionRequirement);

export const REQUIRED_PLATFORM_PERMISSIONS = 'rbac:requiredPlatformPermissions';

export interface PlatformPermissionRequirement {
  keys: PlatformPermissionKey[];
}

/**
 * 平台管理者的端點（apps/platform，docs/architecture/05-tenancy.md §10.2 D5）：依平台管理者的角色判斷，
 * 只在不屬於任何租戶的網域有效，租戶網域上回 `PLATFORM_ONLY`。所有鍵都要有（EVERY）。
 */
export const RequirePlatformPermissions = (...keys: PlatformPermissionKey[]) =>
  SetMetadata(REQUIRED_PLATFORM_PERMISSIONS, { keys } satisfies PlatformPermissionRequirement);
