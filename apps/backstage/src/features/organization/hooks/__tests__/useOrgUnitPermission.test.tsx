import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';

import { registerOrganizationPagePermissions } from '../../permission';
import { useOrgUnitPermission } from '../useOrgUnitPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerOrganizationPagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useOrgUnitPermission（docs/architecture/backend/23-organization.md §7）', () => {
  it('auditor（只有 orgUnit:read）只能看', () => {
    hydrate([PermissionKey['orgUnit:read']]);
    expect(renderHook(() => useOrgUnitPermission()).result.current).toMatchObject({
      canAccess: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canViewMembers: false,
    });
  });

  it('create／update／delete 各自對應自己的權限鍵', () => {
    hydrate([
      PermissionKey['orgUnit:read'],
      PermissionKey['orgUnit:update'],
      PermissionKey['user:read'],
    ]);
    expect(renderHook(() => useOrgUnitPermission()).result.current).toMatchObject({
      canCreate: false,
      canUpdate: true,
      canDelete: false,
      canViewMembers: true,
    });
  });

  it('沒有 orgUnit:read：進不了組織頁', () => {
    hydrate([PermissionKey['user:read']]);
    expect(renderHook(() => useOrgUnitPermission()).result.current.canAccess).toBe(false);
  });

  it('權限未水合：什麼都不能做', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => useOrgUnitPermission()).result.current).toMatchObject({
      hydrated: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    });
  });
});
