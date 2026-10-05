import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';

import { registerJobPagePermissions } from '../../permission';
import { useJobPermission } from '../useJobPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerJobPagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useJobPermission（feature 的權限 facade）', () => {
  it('auditor（只有 job:read）進得了頁面但不能重試', () => {
    hydrate([PermissionKey['job:read']]);
    expect(renderHook(() => useJobPermission()).result.current).toMatchObject({
      canAccess: true,
      canRetry: false,
    });
  });

  it('admin（job:read ＋ job:retry）可以重試', () => {
    hydrate([PermissionKey['job:read'], PermissionKey['job:retry']]);
    expect(renderHook(() => useJobPermission()).result.current).toMatchObject({
      canAccess: true,
      canRetry: true,
    });
  });

  it('沒有 job:read 進不了頁面', () => {
    hydrate([PermissionKey['auditLog:read']]);
    expect(renderHook(() => useJobPermission()).result.current.canAccess).toBe(false);
  });
});
