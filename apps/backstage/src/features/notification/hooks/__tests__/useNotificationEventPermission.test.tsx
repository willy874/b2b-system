import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';

import { registerNotificationPagePermissions } from '../../permission';
import { useNotificationEventPermission } from '../useNotificationEventPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerNotificationPagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useNotificationEventPermission（docs/architecture/backend/16-notification-event.md §9.2 D10）', () => {
  it('system:read → 能檢視，不能開關', () => {
    hydrate([PermissionKey['system:read']]);
    expect(renderHook(() => useNotificationEventPermission()).result.current).toMatchObject({
      canAccess: true,
      canUpdate: false,
    });
  });

  it('system:read ＋ system:update → 能開關與還原預設', () => {
    hydrate([PermissionKey['system:read'], PermissionKey['system:update']]);
    expect(renderHook(() => useNotificationEventPermission()).result.current.canUpdate).toBe(true);
  });

  it('沒有 system:read → 進不了頁面（notification:read 不算）', () => {
    hydrate([PermissionKey['notification:read']]);
    expect(renderHook(() => useNotificationEventPermission()).result.current.canAccess).toBe(false);
  });

  it('權限未水合 → hydrated 為 false、全部為 false', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => useNotificationEventPermission()).result.current).toMatchObject({
      hydrated: false,
      canAccess: false,
      canUpdate: false,
    });
  });
});
