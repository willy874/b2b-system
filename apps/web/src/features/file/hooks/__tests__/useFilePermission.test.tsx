import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import { usePermissionStore } from '@/core/store';

import { registerFilePagePermissions } from '../../permission';
import { useFilePermission } from '../useFilePermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerFilePagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useFilePermission（檔案管理器的權限 facade）', () => {
  it('有全部權限 → 可以上傳、建立資料夾、改名、移動、刪除', () => {
    hydrate([
      PermissionKey['file:read'],
      PermissionKey['file:create'],
      PermissionKey['file:update'],
      PermissionKey['file:delete'],
    ]);
    expect(renderHook(() => useFilePermission()).result.current).toMatchObject({
      canAccess: true,
      canUpload: true,
      canCreateFolder: true,
      canRename: true,
      canMove: true,
      canDelete: true,
    });
  });

  it('只有 file:read（auditor）→ 只能看，上傳、建立資料夾、改名、移動、刪除都不顯示', () => {
    hydrate([PermissionKey['file:read']]);
    expect(renderHook(() => useFilePermission()).result.current).toMatchObject({
      canAccess: true,
      canUpload: false,
      canCreateFolder: false,
      canRename: false,
      canMove: false,
      canDelete: false,
    });
  });

  it('有 file:update 沒有 file:create → 可以移動，不能建立資料夾', () => {
    hydrate([PermissionKey['file:read'], PermissionKey['file:update']]);
    expect(renderHook(() => useFilePermission()).result.current).toMatchObject({
      canCreateFolder: false,
      canMove: true,
    });
  });

  it('權限未水合 → 所有操作都是 false（按鈕不會先出現再消失）', () => {
    usePermissionStore.setState({
      permissions: new Set([PermissionKey['file:read'], PermissionKey['file:create']]),
      hydrated: false,
    });
    expect(renderHook(() => useFilePermission()).result.current).toMatchObject({
      canUpload: false,
      canCreateFolder: false,
      canRename: false,
      canMove: false,
      canDelete: false,
    });
  });
});
