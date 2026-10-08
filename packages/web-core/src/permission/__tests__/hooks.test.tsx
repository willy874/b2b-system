import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePermissionStore } from '../../store/permission';
import { definePageKey, PermissionMatch } from '../constants';
import { usePageAccess, usePageAccessChecker, usePagePermission, usePermission } from '../hooks';
import { registerPagePermission, resetPagePermissionRegistry } from '../registry';

const ROLE_PAGE = definePageKey('ROLE');

function hydrate(keys: string[]): void {
  act(() => usePermissionStore.getState().setPermissions(keys));
}

beforeEach(() => {
  resetPagePermissionRegistry();
  registerPagePermission(ROLE_PAGE, {
    route: '/role',
    rule: { access: ['role:read'], match: PermissionMatch.EVERY, resource: 'role' },
  });
  hydrate(['role:read']);
});

describe('權限 hooks 的參考穩定（memo 的依賴；docs/architecture/frontend/06-permission.md）', () => {
  it('usePermission：權限沒變時 rerender 回傳同一個物件，權限改變後才換新', () => {
    const { result, rerender } = renderHook(() => usePermission());
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);

    hydrate(['role:read', 'role:delete']);
    expect(result.current).not.toBe(first);
    expect(result.current.can('role:delete')).toBe(true);
  });

  it('usePageAccessChecker：canAccessPage 是穩定的 predicate，權限改變後才換新', () => {
    const { result, rerender } = renderHook(() => usePageAccessChecker());
    const first = result.current.canAccessPage;

    rerender();
    expect(result.current.canAccessPage).toBe(first);
    expect(first(ROLE_PAGE)).toBe(true);

    hydrate([]);
    expect(result.current.canAccessPage).not.toBe(first);
    expect(result.current.canAccessPage(ROLE_PAGE)).toBe(false);
  });

  it('usePagePermission：權限沒變時 rerender 回傳同一個物件', () => {
    const { result, rerender } = renderHook(() => usePagePermission(ROLE_PAGE));
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);
    expect(first).toMatchObject({ hydrated: true, canAccess: true, canDelete: false });
  });
});

describe('usePermission（docs/architecture/frontend/10-testing.md §6 權限）', () => {
  it('canSome([]) 回 true（空陣列＝不設限）', () => {
    hydrate([]);
    const { result } = renderHook(() => usePermission());
    expect(result.current.canSome([])).toBe(true);
  });

  it('canEvery([]) 回 true', () => {
    hydrate([]);
    const { result } = renderHook(() => usePermission());
    expect(result.current.canEvery([])).toBe(true);
  });

  it('canSome 持有任一鍵即為 true，全都沒有為 false', () => {
    const { result } = renderHook(() => usePermission());
    expect(result.current.canSome(['user:read', 'role:read'])).toBe(true);
    expect(result.current.canSome(['user:read', 'user:delete'])).toBe(false);
  });

  it('canEvery 缺任一鍵即為 false', () => {
    const { result } = renderHook(() => usePermission());
    expect(result.current.canEvery(['role:read', 'role:delete'])).toBe(false);
  });

  it('未水合時 hydrated 為 false、can 一律 false', () => {
    act(() => usePermissionStore.getState().clear());
    const { result } = renderHook(() => usePermission());
    expect(result.current.hydrated).toBe(false);
    expect(result.current.can('role:read')).toBe(false);
  });
});

describe('usePagePermission', () => {
  it('依頁面的 resource 派生 CRUD 能力', () => {
    hydrate(['role:read', 'role:create', 'role:update']);
    const { result } = renderHook(() => usePagePermission(ROLE_PAGE));
    expect(result.current).toEqual({
      hydrated: true,
      canAccess: true,
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    });
  });

  it('頁面沒有 resource 時 CRUD 能力恆為 false', () => {
    const PAGE = definePageKey('DASHBOARD');
    registerPagePermission(PAGE, {
      route: '/dashboard',
      rule: { access: ['role:read'], match: PermissionMatch.EVERY },
    });
    const { result } = renderHook(() => usePagePermission(PAGE));
    expect(result.current).toMatchObject({ canAccess: true, canRead: false, canDelete: false });
  });

  it('頁面未註冊 → 丟例外（不 fail-open）', () => {
    expect(() => renderHook(() => usePagePermission(definePageKey('MISSING')))).toThrow(
      /not registered/,
    );
  });
});

describe('usePageAccessChecker', () => {
  it('未註冊的頁面（feature 未啟用）一律不可進入', () => {
    const { result } = renderHook(() => usePageAccessChecker());
    expect(result.current.canAccessPage(definePageKey('MISSING'))).toBe(false);
  });

  it('頁面在執行期註冊後判斷跟著更新', () => {
    const PAGE = definePageKey('USER');
    const { result } = renderHook(() => usePageAccessChecker());
    expect(result.current.canAccessPage(PAGE)).toBe(false);

    act(() => {
      registerPagePermission(PAGE, {
        route: '/user',
        rule: { access: [], match: PermissionMatch.SOME },
      });
    });
    expect(result.current.canAccessPage(PAGE)).toBe(true);
  });
});

describe('usePageAccess（route guard）', () => {
  it('不受管的路徑 → gated false、canAccess true', () => {
    const { result } = renderHook(() => usePageAccess('/auth/login'));
    expect(result.current).toEqual({ hydrated: true, gated: false, canAccess: true });
  });

  it('access 為空陣列的頁面 → 不設閘門', () => {
    const PAGE = definePageKey('PROFILE');
    registerPagePermission(PAGE, {
      route: '/profile',
      rule: { access: [], match: PermissionMatch.EVERY },
    });
    const { result } = renderHook(() => usePageAccess('/profile/security'));
    expect(result.current).toEqual({ hydrated: true, page: PAGE, gated: false, canAccess: true });
  });

  it('有權限 → gated 且可進入', () => {
    const { result } = renderHook(() => usePageAccess('/role/abc/permission'));
    expect(result.current).toEqual({
      hydrated: true,
      page: ROLE_PAGE,
      gated: true,
      canAccess: true,
    });
  });

  it('無權限 → gated 且不可進入', () => {
    hydrate([]);
    const { result } = renderHook(() => usePageAccess('/role'));
    expect(result.current).toMatchObject({ gated: true, canAccess: false });
  });

  it('未水合 → hydrated 為 false 且不可進入', () => {
    act(() => usePermissionStore.getState().clear());
    const { result } = renderHook(() => usePageAccess('/role'));
    expect(result.current).toMatchObject({ hydrated: false, gated: true, canAccess: false });
  });
});
