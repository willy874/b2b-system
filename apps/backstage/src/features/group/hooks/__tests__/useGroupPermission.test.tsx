import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';

import { registerGroupPagePermissions } from '../../permission';
import { useGroupPermission } from '../useGroupPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerGroupPagePermissions();
  resetFeatureStore();
  featureStore.setState({ resolved: true, statuses: new Map([['dataTransfer', 'ready']]) });
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useGroupPermission', () => {
  it('只有 group:read → 能進列表，不能改、不能指派角色、不能匯入匯出', () => {
    hydrate([PermissionKey['group:read']]);
    expect(renderHook(() => useGroupPermission()).result.current).toMatchObject({
      canAccess: true,
      canRead: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canAssignRole: false,
      canViewMembers: false,
      canViewRoles: false,
      canExport: false,
      canImport: false,
      canImportMembers: false,
    });
  });

  it('成員與角色清單各自要讀得到使用者、角色', () => {
    hydrate([PermissionKey['group:read'], PermissionKey['user:read'], PermissionKey['role:read']]);
    expect(renderHook(() => useGroupPermission()).result.current).toMatchObject({
      canViewMembers: true,
      canViewRoles: true,
    });
  });

  it('group:assignRole → 能讓群組持有角色', () => {
    hydrate([PermissionKey['group:read'], PermissionKey['group:assignRole']]);
    expect(renderHook(() => useGroupPermission()).result.current.canAssignRole).toBe(true);
  });

  it('匯出要 group:export；匯入沿用 group:update；匯入成員另要 user:read', () => {
    hydrate([
      PermissionKey['group:read'],
      PermissionKey['group:export'],
      PermissionKey['group:update'],
    ]);
    expect(renderHook(() => useGroupPermission()).result.current).toMatchObject({
      canExport: true,
      canImport: true,
      canImportMembers: false,
    });

    hydrate([
      PermissionKey['group:read'],
      PermissionKey['group:update'],
      PermissionKey['user:read'],
    ]);
    expect(renderHook(() => useGroupPermission()).result.current).toMatchObject({
      canExport: false,
      canImportMembers: true,
    });
  });

  it('租戶沒有啟用 dataTransfer → 有權限也沒有匯入匯出的入口', () => {
    featureStore.setState({ statuses: new Map() });
    hydrate([
      PermissionKey['group:read'],
      PermissionKey['group:export'],
      PermissionKey['group:update'],
      PermissionKey['user:read'],
    ]);
    expect(renderHook(() => useGroupPermission()).result.current).toMatchObject({
      canUpdate: true,
      canExport: false,
      canImport: false,
      canImportMembers: false,
    });
  });

  it('沒有 group:read → 進不了頁面', () => {
    hydrate([]);
    expect(renderHook(() => useGroupPermission()).result.current.canAccess).toBe(false);
  });

  it('權限未水合 → 全部為 false', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => useGroupPermission()).result.current).toMatchObject({
      hydrated: false,
      canAccess: false,
      canUpdate: false,
      canExport: false,
    });
  });
});
