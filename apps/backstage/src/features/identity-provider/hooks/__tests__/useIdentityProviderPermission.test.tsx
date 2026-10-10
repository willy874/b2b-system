import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';

import { registerIdentityProviderPagePermissions } from '../../permission';
import { useIdentityProviderPermission } from '../useIdentityProviderPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerIdentityProviderPagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useIdentityProviderPermission', () => {
  it('只有 identityProvider:read → 只能看', () => {
    hydrate([PermissionKey['identityProvider:read']]);
    expect(renderHook(() => useIdentityProviderPermission()).result.current).toMatchObject({
      canAccess: true,
      canRead: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    });
  });

  it('create／update／delete 各自對應自己的權限鍵', () => {
    hydrate([PermissionKey['identityProvider:read'], PermissionKey['identityProvider:delete']]);
    expect(renderHook(() => useIdentityProviderPermission()).result.current).toMatchObject({
      canCreate: false,
      canUpdate: false,
      canDelete: true,
    });
  });

  it('沒有 identityProvider:read → 進不了頁面', () => {
    hydrate([PermissionKey['identityProvider:create']]);
    expect(renderHook(() => useIdentityProviderPermission()).result.current.canAccess).toBe(false);
  });

  it('權限未水合 → hydrated 為 false、全部為 false', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => useIdentityProviderPermission()).result.current).toMatchObject({
      hydrated: false,
      canAccess: false,
      canCreate: false,
    });
  });
});
