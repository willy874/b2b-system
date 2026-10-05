import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';

import { registerApprovalPagePermissions } from '../../permission';
import { useApprovalPermission } from '../useApprovalPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalPagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useApprovalPermission（feature 的權限 facade）', () => {
  it('auditor（只有 approval:read）看得到但不能審核', () => {
    hydrate([PermissionKey['approval:read']]);
    expect(renderHook(() => useApprovalPermission()).result.current).toMatchObject({
      canAccess: true,
      canReview: false,
      canApproveRegistration: false,
    });
  });

  it('只有 approval:review 而沒有 user:create → 能駁回但不能核准註冊', () => {
    hydrate([PermissionKey['approval:read'], PermissionKey['approval:review']]);
    expect(renderHook(() => useApprovalPermission()).result.current).toMatchObject({
      canReview: true,
      canApproveRegistration: false,
    });
  });

  it('只有 user:assignRole 而讀不到角色選項 → canAssignRole 為 false', () => {
    hydrate([PermissionKey['approval:review'], PermissionKey['user:assignRole']]);
    expect(renderHook(() => useApprovalPermission()).result.current.canAssignRole).toBe(false);
  });

  it('canAssignRole 需要 user:assignRole ＋ role:read', () => {
    hydrate([
      PermissionKey['approval:review'],
      PermissionKey['user:assignRole'],
      PermissionKey['role:read'],
    ]);
    expect(renderHook(() => useApprovalPermission()).result.current.canAssignRole).toBe(true);
  });

  it('admin 擁有完整能力', () => {
    hydrate([
      PermissionKey['approval:read'],
      PermissionKey['approval:review'],
      PermissionKey['user:create'],
      PermissionKey['user:assignRole'],
      PermissionKey['role:read'],
    ]);
    expect(renderHook(() => useApprovalPermission()).result.current).toMatchObject({
      canAccess: true,
      canReview: true,
      canApproveRegistration: true,
      canAssignRole: true,
    });
  });
});
