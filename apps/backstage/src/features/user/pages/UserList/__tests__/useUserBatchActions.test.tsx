import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import { usePermissionStore } from '@/core/store';
import { AllProviders } from '@/test/renderWithPermissions';

import { registerUserPagePermissions } from '../../../permission';
import type { UserRowVM } from '../adapter';
import { useUserBatchActions } from '../useUserBatchActions';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerUserPagePermissions();
});

function hydrate(keys: PermissionKey[], hydrated = true): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated });
}

function actions() {
  const { result } = renderHook(() => useUserBatchActions(), { wrapper: AllProviders });
  return Object.fromEntries(result.current.map((action) => [action.id, action]));
}

const row = (overrides: Partial<UserRowVM>): UserRowVM => ({
  id: 'u1',
  email: 'u1@example.com',
  displayName: 'U1',
  username: '-',
  status: 'active',
  roles: [],
  lastLoginAt: null,
  createdAt: new Date(0),
  version: 1,
  isSelf: false,
  canDelete: true,
  canUpdate: true,
  canUnlock: false,
  ...overrides,
});

describe('useUserBatchActions（使用者列表的批次動作）', () => {
  it('有 user:update ＋ user:delete → 四個動作都顯示', () => {
    hydrate([
      PermissionKey['user:read'],
      PermissionKey['user:update'],
      PermissionKey['user:delete'],
    ]);
    const result = actions();
    expect(Object.keys(result)).toEqual(['activate', 'deactivate', 'unlock', 'delete']);
    expect(Object.values(result).every((action) => !action.hidden)).toBe(true);
  });

  it('只有 user:read → 全部隱藏', () => {
    hydrate([PermissionKey['user:read']]);
    expect(Object.values(actions()).every((action) => action.hidden)).toBe(true);
  });

  it('權限未水合 → 全部隱藏，不閃現', () => {
    hydrate([PermissionKey['user:update'], PermissionKey['user:delete']], false);
    expect(Object.values(actions()).every((action) => action.hidden)).toBe(true);
  });

  it('資格沿用列旗標：自己不適用、啟用只對停用中的人、解鎖只對被鎖定的人', () => {
    hydrate([PermissionKey['user:update'], PermissionKey['user:delete']]);
    const { activate, deactivate, unlock, delete: remove } = actions();

    const self = row({ isSelf: true, canDelete: false, canUpdate: false });
    expect(remove!.isEligible(self)).toBe(false);
    expect(deactivate!.isEligible(self)).toBe(false);

    expect(activate!.isEligible(row({ status: 'inactive' }))).toBe(true);
    expect(activate!.isEligible(row({ status: 'active' }))).toBe(false);
    expect(deactivate!.isEligible(row({ status: 'inactive' }))).toBe(false);
    expect(unlock!.isEligible(row({ status: 'locked', canUnlock: true }))).toBe(true);
    expect(unlock!.isEligible(row({}))).toBe(false);
  });
});
