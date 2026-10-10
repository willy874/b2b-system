import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';

import { registerSettingPagePermissions } from '../../permission';
import { useSettingPermission } from '../useSettingPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerSettingPagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useSettingPermission（系統設定的「一般」分頁）', () => {
  it('system:read → 能檢視，不能修改', () => {
    hydrate([PermissionKey['system:read']]);
    expect(renderHook(() => useSettingPermission()).result.current).toMatchObject({
      canAccess: true,
      canUpdate: false,
    });
  });

  it('system:read ＋ system:update → 能修改與還原預設', () => {
    hydrate([PermissionKey['system:read'], PermissionKey['system:update']]);
    expect(renderHook(() => useSettingPermission()).result.current.canUpdate).toBe(true);
  });

  it('只有 mfaPolicy:read（進得了系統設定入口）→ 進不了「一般」分頁', () => {
    hydrate([PermissionKey['mfaPolicy:read']]);
    expect(renderHook(() => useSettingPermission()).result.current.canAccess).toBe(false);
  });

  it('權限未水合 → hydrated 為 false、全部為 false', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => useSettingPermission()).result.current).toMatchObject({
      hydrated: false,
      canAccess: false,
      canUpdate: false,
    });
  });
});
