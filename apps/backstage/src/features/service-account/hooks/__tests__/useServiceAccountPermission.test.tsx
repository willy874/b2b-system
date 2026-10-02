import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import { usePermissionStore } from '@/core/store';

import { registerServiceAccountPagePermissions } from '../../permission';
import { useServiceAccountPermission } from '../useServiceAccountPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerServiceAccountPagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useServiceAccountPermission（docs/architecture/06-external-api.md §9.2 D14）', () => {
  it('auditor（只有 serviceAccount:read）只能看：不能建立、改角色、管理 token', () => {
    hydrate([PermissionKey['serviceAccount:read'], PermissionKey['role:read']]);
    expect(renderHook(() => useServiceAccountPermission()).result.current).toMatchObject({
      canAccess: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canAssignRole: false,
      canManageTokens: false,
    });
  });

  it('serviceAccount:update 但讀不到角色：能管理 token，不能改角色（選項要 role:read）', () => {
    hydrate([PermissionKey['serviceAccount:read'], PermissionKey['serviceAccount:update']]);
    expect(renderHook(() => useServiceAccountPermission()).result.current).toMatchObject({
      canManageTokens: true,
      canAssignRole: false,
    });
  });

  it('token 可以限縮到的權限：只有自己持有的，依鍵排序', () => {
    hydrate([PermissionKey['user:read'], PermissionKey['serviceAccount:read']]);
    expect(renderHook(() => useServiceAccountPermission()).result.current.scopeOptions).toEqual([
      { key: 'serviceAccount:read', label: 'serviceAccount:read' },
      { key: 'user:read', label: 'user:read' },
    ]);
  });
});
