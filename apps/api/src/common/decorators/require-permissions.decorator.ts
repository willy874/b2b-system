import { SetMetadata } from '@nestjs/common';

import type { PermissionKey } from '../types';

export const REQUIRED_PERMISSIONS = 'rbac:requiredPermissions';

export interface PermissionRequirement {
  keys: PermissionKey[];
  match: 'every' | 'some';
}

export const RequirePermissions = (...keys: PermissionKey[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, { keys, match: 'every' } satisfies PermissionRequirement);

export const RequireAnyPermission = (...keys: PermissionKey[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, { keys, match: 'some' } satisfies PermissionRequirement);
