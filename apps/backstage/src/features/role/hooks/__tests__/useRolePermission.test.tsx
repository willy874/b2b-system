import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';

import { registerRolePagePermissions } from '../../permission';
import { useRolePermission } from '../useRolePermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerRolePagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useRolePermission（feature 的權限 facade）', () => {
  it('只有 role:read 時只能看', () => {
    hydrate([PermissionKey['role:read']]);
    const { result } = renderHook(() => useRolePermission());
    expect(result.current).toMatchObject({
      canAccess: true,
      canRead: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canManagePermission: false,
      canGrantPermission: false,
    });
  });

  it('canManagePermission 需要 role:read ＋ permission:read（不看 role:update）', () => {
    hydrate([PermissionKey['role:read'], PermissionKey['role:update']]);
    expect(renderHook(() => useRolePermission()).result.current.canManagePermission).toBe(false);

    hydrate([PermissionKey['role:read'], PermissionKey['permission:read']]);
    expect(renderHook(() => useRolePermission()).result.current.canManagePermission).toBe(true);
  });

  it('canGrantPermission 對應 role:grantPermission', () => {
    hydrate([PermissionKey['role:read'], PermissionKey['role:grantPermission']]);
    expect(renderHook(() => useRolePermission()).result.current.canGrantPermission).toBe(true);
  });

  it('canViewUsers 對應 user:read', () => {
    hydrate([PermissionKey['role:read'], PermissionKey['user:read']]);
    expect(renderHook(() => useRolePermission()).result.current.canViewUsers).toBe(true);
  });
});
