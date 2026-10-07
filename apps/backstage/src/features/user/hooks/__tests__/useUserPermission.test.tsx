import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';

import { registerUserPagePermissions } from '../../permission';
import { useUserPermission } from '../useUserPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerUserPagePermissions();
});

afterEach(() => resetFeatureStore());

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useUserPermission', () => {
  it('auditor（只有 user:read）不能建立、指派或重設密碼', () => {
    hydrate([PermissionKey['user:read']]);
    expect(renderHook(() => useUserPermission()).result.current).toMatchObject({
      canAccess: true,
      canCreate: false,
      canAssignRole: false,
      canResetPassword: false,
      canUnlock: false,
    });
  });

  it('admin 擁有完整能力', () => {
    hydrate([
      PermissionKey['user:read'],
      PermissionKey['user:create'],
      PermissionKey['user:update'],
      PermissionKey['user:delete'],
      PermissionKey['user:assignRole'],
      PermissionKey['user:resetPassword'],
      PermissionKey['role:read'],
    ]);
    expect(renderHook(() => useUserPermission()).result.current).toMatchObject({
      canCreate: true,
      canDelete: true,
      canAssignRole: true,
      canResetPassword: true,
      canUnlock: true,
      canReadRoles: true,
    });
  });

  it.each([
    ['ready', true],
    ['disabled', false],
  ] as const)(
    'canManageApiTokens 需要 user:update 且租戶啟用 externalApi（%s → %s）',
    (status, expected) => {
      featureStore.setState({ resolved: true, statuses: new Map([['externalApi', status]]) });
      hydrate([PermissionKey['user:read'], PermissionKey['user:update']]);
      expect(renderHook(() => useUserPermission()).result.current.canManageApiTokens).toBe(
        expected,
      );
    },
  );
});
