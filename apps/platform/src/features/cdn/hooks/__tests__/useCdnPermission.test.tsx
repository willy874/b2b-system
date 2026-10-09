import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';

import { registerCdnPagePermissions } from '../../permission';
import { useCdnPermission } from '../useCdnPermission';

function hydrate(keys: PermissionKey[]) {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

beforeEach(() => {
  resetPagePermissionRegistry();
  registerCdnPagePermissions();
});

describe('useCdnPermission（docs/architecture/iam/02-permission-catalog.md §8）', () => {
  it('cdn:read 只能進頁面；update、purge、purgeAll 各自獨立', () => {
    hydrate(['cdn:read']);
    expect(renderHook(() => useCdnPermission()).result.current).toMatchObject({
      canUpdate: false,
      canPurge: false,
      canPurgeAll: false,
    });
    hydrate(['cdn:read', 'cdn:update', 'cdn:purge']);
    expect(renderHook(() => useCdnPermission()).result.current).toMatchObject({
      canUpdate: true,
      canPurge: true,
      canPurgeAll: false,
    });
    hydrate(['cdn:read', 'cdn:purgeAll']);
    expect(renderHook(() => useCdnPermission()).result.current.canPurgeAll).toBe(true);
  });

  it('權限未水合 → 全部是 false', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => useCdnPermission()).result.current).toMatchObject({
      canUpdate: false,
      canPurge: false,
      canPurgeAll: false,
    });
  });
});
