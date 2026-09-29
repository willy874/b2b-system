import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePermissionStore } from '@/core/store';

import { definePageKey, PermissionMatch, PermissionResource } from '../constants';
import { PermissionKey } from '../enums';
import { usePageAccess, usePageAccessChecker, usePagePermission, usePermission } from '../hooks';
import { registerPagePermission, resetPagePermissionRegistry } from '../registry';

const ROLE_PAGE = definePageKey('ROLE');
const HOME_PAGE = definePageKey('HOME');

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

beforeEach(() => {
  resetPagePermissionRegistry();
  usePermissionStore.setState({ permissions: new Set(), hydrated: false });

  registerPagePermission(ROLE_PAGE, {
    route: '/role',
    rule: {
      resource: PermissionResource.ROLE,
      access: [PermissionKey['role:read']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(HOME_PAGE, {
    route: '/',
    rule: { access: [], match: PermissionMatch.EVERY },
  });
});

describe('usePermission', () => {
  it('canSome 對空陣列回 true（不設限）', () => {
    hydrate([]);
    const { result } = renderHook(() => usePermission());
    expect(result.current.canSome([])).toBe(true);
  });

  it('canEvery 需要全部持有', () => {
    hydrate([PermissionKey['role:read']]);
    const { result } = renderHook(() => usePermission());
    expect(result.current.canEvery([PermissionKey['role:read']])).toBe(true);
    expect(
      result.current.canEvery([PermissionKey['role:read'], PermissionKey['permission:read']]),
    ).toBe(false);
  });

  it('未水合時 hydrated 為 false', () => {
    const { result } = renderHook(() => usePermission());
    expect(result.current.hydrated).toBe(false);
  });
});

describe('usePagePermission', () => {
  it('從 resource 派生 CRUD 能力', () => {
    hydrate([PermissionKey['role:read'], PermissionKey['role:create']]);
    const { result } = renderHook(() => usePagePermission(ROLE_PAGE));
    expect(result.current).toMatchObject({
      canAccess: true,
      canRead: true,
      canCreate: true,
      canUpdate: false,
      canDelete: false,
    });
  });

  it('沒有 resource 的頁面：canAccess 為 true，CRUD 全 false', () => {
    hydrate([]);
    const { result } = renderHook(() => usePagePermission(HOME_PAGE));
    expect(result.current).toMatchObject({
      canAccess: true,
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
  });

  it('未註冊的頁面丟例外', () => {
    expect(() => renderHook(() => usePagePermission(definePageKey('NOPE')))).toThrow(
      /not registered/,
    );
  });
});

describe('usePageAccessChecker', () => {
  it('回傳可在迴圈中呼叫的 predicate', () => {
    hydrate([PermissionKey['role:read']]);
    const { result } = renderHook(() => usePageAccessChecker());
    expect([ROLE_PAGE, HOME_PAGE].filter((page) => result.current.canAccessPage(page))).toEqual([
      ROLE_PAGE,
      HOME_PAGE,
    ]);
  });

  it('沒有權限時過濾掉受管頁面', () => {
    hydrate([]);
    const { result } = renderHook(() => usePageAccessChecker());
    expect(result.current.canAccessPage(ROLE_PAGE)).toBe(false);
    expect(result.current.canAccessPage(HOME_PAGE)).toBe(true);
  });
});

describe('usePageAccess', () => {
  it('未註冊的路徑 → 不受管、可進入（fail-open，真正的防線在後端）', () => {
    hydrate([]);
    const { result } = renderHook(() => usePageAccess('/auth/login'));
    expect(result.current).toMatchObject({ gated: false, canAccess: true });
  });

  it('access 為空陣列的頁面不算受管', () => {
    hydrate([]);
    const { result } = renderHook(() => usePageAccess('/'));
    expect(result.current).toMatchObject({ gated: false, canAccess: true, page: HOME_PAGE });
  });

  it('受管頁面：有權限可進入', () => {
    hydrate([PermissionKey['role:read']]);
    const { result } = renderHook(() => usePageAccess('/role/abc/permission'));
    expect(result.current).toMatchObject({ gated: true, canAccess: true, page: ROLE_PAGE });
  });

  it('受管頁面：無權限 → 顯示 403（不是導向）', () => {
    hydrate([]);
    const { result } = renderHook(() => usePageAccess('/role'));
    expect(result.current).toMatchObject({ gated: true, canAccess: false });
  });

  it('未水合時 hydrated 為 false，讓 guard 顯示骨架屏', () => {
    const { result } = renderHook(() => usePageAccess('/role'));
    expect(result.current.hydrated).toBe(false);
  });
});
