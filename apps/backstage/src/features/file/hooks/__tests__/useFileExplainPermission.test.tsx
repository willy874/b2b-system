import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PermissionKey } from '@/core/permission';

import { useFileExplainPermission } from '../useFileExplainPermission';

describe('useFileExplainPermission（docs/architecture/iam/01-model.md §9 G4b）', () => {
  it('有 authz:explain → 能檢查存取（不依賴頁面權限的註冊）', () => {
    usePermissionStore.setState({
      permissions: new Set([PermissionKey['authz:explain']]),
      hydrated: true,
    });
    expect(renderHook(() => useFileExplainPermission()).result.current).toEqual({
      canExplain: true,
    });
  });

  it('沒有 authz:explain → 不能', () => {
    usePermissionStore.setState({
      permissions: new Set([PermissionKey['file:read']]),
      hydrated: true,
    });
    expect(renderHook(() => useFileExplainPermission()).result.current.canExplain).toBe(false);
  });

  it('未水合時為 false（即使集合裡已有權限鍵，也不閃現）', () => {
    usePermissionStore.setState({
      permissions: new Set([PermissionKey['authz:explain']]),
      hydrated: false,
    });
    expect(renderHook(() => useFileExplainPermission()).result.current.canExplain).toBe(false);
  });
});
