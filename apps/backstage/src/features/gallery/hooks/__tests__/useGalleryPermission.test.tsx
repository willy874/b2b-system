import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';

import { registerGalleryPagePermissions } from '../../permission';
import { useGalleryPermission } from '../useGalleryPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerGalleryPagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useGalleryPermission（docs/architecture/frontend/24-gallery.md §8）', () => {
  it('member（只有 gallery:read）只能看', () => {
    hydrate([PermissionKey['gallery:read']]);
    expect(renderHook(() => useGalleryPermission()).result.current).toMatchObject({
      canAccess: true,
      canRead: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    });
  });

  it('create／update／delete 各自對應自己的權限鍵', () => {
    hydrate([PermissionKey['gallery:read'], PermissionKey['gallery:update']]);
    expect(renderHook(() => useGalleryPermission()).result.current).toMatchObject({
      canCreate: false,
      canUpdate: true,
      canDelete: false,
    });
  });

  it('沒有 gallery:read → 進不了頁面', () => {
    hydrate([]);
    expect(renderHook(() => useGalleryPermission()).result.current.canAccess).toBe(false);
  });

  it('權限未水合 → 全部為 false', () => {
    usePermissionStore.setState({
      permissions: new Set([PermissionKey['gallery:create']]),
      hydrated: false,
    });
    expect(renderHook(() => useGalleryPermission()).result.current).toMatchObject({
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    });
  });
});
