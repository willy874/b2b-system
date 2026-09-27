import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import { usePermissionStore } from '@/core/store';
import { AllProviders } from '@/test/renderWithPermissions';

import { registerRolePagePermissions } from '../../../permission';
import type { RoleRowVM } from '../adapter';
import { useRoleBatchActions } from '../useRoleBatchActions';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerRolePagePermissions();
});

function deleteAction(keys: PermissionKey[], hydrated = true) {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated });
  const { result } = renderHook(() => useRoleBatchActions(), { wrapper: AllProviders });
  return result.current.find((action) => action.id === 'delete')!;
}

const row = (overrides: Partial<RoleRowVM>): RoleRowVM => ({
  id: 'r1',
  slug: 'r1',
  name: 'R1',
  description: '-',
  isSystem: false,
  permissionCount: 0,
  userCount: 0,
  createdAt: new Date(0),
  canDelete: true,
  canEdit: true,
  ...overrides,
});

describe('useRoleBatchActions（角色列表的批次動作）', () => {
  it('有 role:delete → 顯示批次刪除', () => {
    expect(deleteAction([PermissionKey['role:read'], PermissionKey['role:delete']]).hidden).toBe(
      false,
    );
  });

  it('沒有 role:delete → 隱藏', () => {
    expect(deleteAction([PermissionKey['role:read']]).hidden).toBe(true);
  });

  it('權限未水合 → 隱藏，不閃現', () => {
    expect(deleteAction([PermissionKey['role:delete']], false).hidden).toBe(true);
  });

  it('系統角色與仍有人持有的角色不適用（批次不強制刪除）', () => {
    const action = deleteAction([PermissionKey['role:delete']]);
    expect(action.isEligible(row({}))).toBe(true);
    expect(action.isEligible(row({ isSystem: true, canDelete: false }))).toBe(false);
    expect(action.isEligible(row({ userCount: 2 }))).toBe(false);
  });
});
