import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import { usePermissionStore } from '@/core/store';

import { registerFilePagePermissions } from '../../permission';
import { selectionCapabilities, useFilePermission } from '../useFilePermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerFilePagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useFilePermission（docs/architecture/frontend/12-file-manager.md §13）', () => {
  it('只有 file:access 也進得了頁面；按鈕看目前位置的 capabilities', () => {
    hydrate([PermissionKey['file:access']]);
    const { result } = renderHook(() => useFilePermission({ canCreate: true, canShare: true }));
    expect(result.current).toMatchObject({
      canAccess: true,
      canUpload: true,
      canCreateFolder: true,
      canShare: true,
    });
  });

  it('全域 file:read（auditor）進得來；位置不能建立時不顯示上傳與新增資料夾', () => {
    hydrate([PermissionKey['file:read']]);
    const { result } = renderHook(() => useFilePermission({ canCreate: false }));
    expect(result.current).toMatchObject({
      canAccess: true,
      canUpload: false,
      canCreateFolder: false,
      canShare: false,
    });
  });

  it('沒有 file:access 也沒有 file:read → 不能進入，也不顯示任何操作', () => {
    hydrate([PermissionKey['file:create']]);
    const { result } = renderHook(() => useFilePermission({ canCreate: true }));
    expect(result.current).toMatchObject({ canAccess: false, canUpload: false });
  });

  it('資料夾清單還沒載入（location 為 undefined）→ 操作都是 false', () => {
    hydrate([PermissionKey['file:access']]);
    const { result } = renderHook(() => useFilePermission(undefined));
    expect(result.current).toMatchObject({ canUpload: false, canShare: false });
  });

  it('權限未水合 → 所有操作都是 false（按鈕不會先出現再消失）', () => {
    usePermissionStore.setState({
      permissions: new Set([PermissionKey['file:read'], PermissionKey['file:create']]),
      hydrated: false,
    });
    const { result } = renderHook(() => useFilePermission({ canCreate: true, canShare: true }));
    expect(result.current).toMatchObject({
      canUpload: false,
      canCreateFolder: false,
      canShare: false,
    });
  });
});

describe('selectionCapabilities（選取的項目取交集）', () => {
  const file = (canUpdate: boolean, canDelete: boolean) =>
    ({ type: 'file', canUpdate, canDelete }) as const;

  it('每一項都能做才算；改名只在單選時', () => {
    expect(selectionCapabilities([file(true, true), file(true, false)])).toEqual({
      canRename: false,
      canMove: true,
      canDelete: false,
      canShare: false,
      canRequestAccess: false,
    });
    expect(selectionCapabilities([file(true, true)])).toMatchObject({ canRename: true });
  });

  it('共用只在單選一個可管理的資料夾時', () => {
    const folder = { type: 'folder', canUpdate: false, canDelete: false, canShare: true } as const;
    expect(selectionCapabilities([folder]).canShare).toBe(true);
    expect(selectionCapabilities([folder, folder]).canShare).toBe(false);
  });

  it('沒有選取 → 都是 false', () => {
    expect(selectionCapabilities([])).toEqual({
      canRename: false,
      canMove: false,
      canDelete: false,
      canShare: false,
      canRequestAccess: false,
    });
  });

  it('申請存取：只選一個鎖住、還沒申請過的資料夾', () => {
    const locked = { type: 'folder', canUpdate: false, canDelete: false, canRead: false } as const;
    expect(selectionCapabilities([locked]).canRequestAccess).toBe(true);
    expect(
      selectionCapabilities([{ ...locked, hasPendingAccessRequest: true }]).canRequestAccess,
    ).toBe(false);
    expect(selectionCapabilities([{ ...locked, canRead: true }]).canRequestAccess).toBe(false);
  });
});
