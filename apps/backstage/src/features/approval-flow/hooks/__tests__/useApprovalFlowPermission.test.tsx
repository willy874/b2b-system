import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';

import { registerApprovalFlowPagePermissions } from '../../permission';
import { useApprovalFlowPermission } from '../useApprovalFlowPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalFlowPagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useApprovalFlowPermission（docs/architecture/backend/20-approval.md §9.14）', () => {
  it('只有 approvalFlow:read → 能檢視與試算，不能儲存', () => {
    hydrate([PermissionKey['approvalFlow:read']]);
    expect(renderHook(() => useApprovalFlowPermission()).result.current).toMatchObject({
      hydrated: true,
      canAccess: true,
      canUpdate: false,
    });
  });

  it('approvalFlow:read ＋ approvalFlow:update → 能儲存', () => {
    hydrate([PermissionKey['approvalFlow:read'], PermissionKey['approvalFlow:update']]);
    expect(renderHook(() => useApprovalFlowPermission()).result.current.canUpdate).toBe(true);
  });

  it('只有 approvalFlow:update、進不了頁面 → 也不能儲存', () => {
    hydrate([PermissionKey['approvalFlow:update']]);
    expect(renderHook(() => useApprovalFlowPermission()).result.current).toMatchObject({
      canAccess: false,
      canUpdate: false,
    });
  });

  it('規則選擇器的選項各自看讀取權限', () => {
    hydrate([
      PermissionKey['approvalFlow:read'],
      PermissionKey['user:read'],
      PermissionKey['role:read'],
    ]);
    expect(renderHook(() => useApprovalFlowPermission()).result.current).toMatchObject({
      canSearchUsers: true,
      canListGroups: false,
      canListRoles: true,
      canListOrgUnits: false,
    });
  });

  it('權限未水合 → 全部為 false', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => useApprovalFlowPermission()).result.current).toMatchObject({
      hydrated: false,
      canAccess: false,
      canUpdate: false,
      canSearchUsers: false,
    });
  });

  it('權限沒變時回傳同一個物件（memo 的依賴）', () => {
    hydrate([PermissionKey['approvalFlow:read']]);
    const hook = renderHook(() => useApprovalFlowPermission());
    const first = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(first);
  });
});
