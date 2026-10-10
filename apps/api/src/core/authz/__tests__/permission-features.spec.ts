import { describe, expect, it } from 'vitest';

import { ALL_PERMISSION_KEYS } from '@/db/seeds/permissions';

import { TENANT_FEATURES } from '../../tenant/tenant-features';
import { isPermissionAvailable, permissionFeaturesOf } from '../permission-features';

describe('permissionFeaturesOf（docs/architecture/05-tenancy.md §15.2 D1）', () => {
  it('整個資源屬於一個 feature', () => {
    expect(permissionFeaturesOf('webhook:read')).toEqual(['webhook']);
    expect(permissionFeaturesOf('serviceAccount:create')).toEqual(['externalApi']);
    expect(permissionFeaturesOf('orgUnit:read')).toEqual(['organization']);
    expect(permissionFeaturesOf('approvalFlow:update')).toEqual(['approvalChain']);
  });

  it('匯出另外屬於 dataTransfer；常駐資源的匯出只屬於 dataTransfer', () => {
    expect(permissionFeaturesOf('group:export')).toEqual(['group', 'dataTransfer']);
    expect(permissionFeaturesOf('auditLog:export')).toEqual(['auditLog', 'dataTransfer']);
    expect(permissionFeaturesOf('user:export')).toEqual(['dataTransfer']);
  });

  it('個別的鍵：approval:override 屬於多階段審批，其餘審批的鍵常駐', () => {
    expect(permissionFeaturesOf('approval:override')).toEqual(['approvalChain']);
    expect(permissionFeaturesOf('approval:review')).toEqual([]);
  });

  it('RBAC 骨架的鍵常駐', () => {
    for (const key of [
      'user:read',
      'role:grantPermission',
      'system:update',
      'authz:explain',
    ] as const) {
      expect(permissionFeaturesOf(key)).toEqual([]);
    }
  });

  it('全部啟用時每個鍵都可見；全部關閉時只剩常駐的鍵', () => {
    expect(ALL_PERMISSION_KEYS.every((key) => isPermissionAvailable(key, TENANT_FEATURES))).toBe(
      true,
    );
    const alwaysOn = ALL_PERMISSION_KEYS.filter((key) => isPermissionAvailable(key, []));
    expect(alwaysOn).toContain('user:read');
    expect(alwaysOn).not.toContain('file:read');
    expect(alwaysOn).not.toContain('role:export');
  });
});
