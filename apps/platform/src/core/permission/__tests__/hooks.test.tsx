import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { definePageKey, PermissionMatch, PermissionResource } from '..';
import { usePageAccess, usePageAccessChecker, usePagePermission, usePermission } from '..';
import { registerPagePermission, resetPagePermissionRegistry } from '..';
import { PermissionKey } from '../enums';

const TENANT_PAGE_KEY = definePageKey('TENANT');
const HOME_PAGE = definePageKey('HOME');

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

beforeEach(() => {
  resetPagePermissionRegistry();
  usePermissionStore.setState({ permissions: new Set(), hydrated: false });

  registerPagePermission(TENANT_PAGE_KEY, {
    route: '/tenant',
    rule: {
      resource: PermissionResource.TENANT,
      access: [PermissionKey['tenant:read']],
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
    hydrate([PermissionKey['tenant:read']]);
    const { result } = renderHook(() => usePermission());
    expect(result.current.canEvery([PermissionKey['tenant:read']])).toBe(true);
    expect(
      result.current.canEvery([PermissionKey['tenant:read'], PermissionKey['tenant:update']]),
    ).toBe(false);
  });

  it('未水合時 hydrated 為 false', () => {
    const { result } = renderHook(() => usePermission());
    expect(result.current.hydrated).toBe(false);
  });
});

describe('usePagePermission', () => {
  it('從 resource 派生 CRUD 能力', () => {
    hydrate([PermissionKey['tenant:read'], PermissionKey['tenant:create']]);
    const { result } = renderHook(() => usePagePermission(TENANT_PAGE_KEY));
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
    hydrate([PermissionKey['tenant:read']]);
    const { result } = renderHook(() => usePageAccessChecker());
    expect(
      [TENANT_PAGE_KEY, HOME_PAGE].filter((page) => result.current.canAccessPage(page)),
    ).toEqual([TENANT_PAGE_KEY, HOME_PAGE]);
  });

  it('沒有權限時過濾掉受管頁面', () => {
    hydrate([]);
    const { result } = renderHook(() => usePageAccessChecker());
    expect(result.current.canAccessPage(TENANT_PAGE_KEY)).toBe(false);
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
    hydrate([PermissionKey['tenant:read']]);
    const { result } = renderHook(() => usePageAccess('/tenant/abc'));
    expect(result.current).toMatchObject({ gated: true, canAccess: true, page: TENANT_PAGE_KEY });
  });

  it('受管頁面：無權限 → 顯示 403（不是導向）', () => {
    hydrate([]);
    const { result } = renderHook(() => usePageAccess('/tenant'));
    expect(result.current).toMatchObject({ gated: true, canAccess: false });
  });

  it('未水合時 hydrated 為 false，讓 guard 顯示骨架屏', () => {
    const { result } = renderHook(() => usePageAccess('/tenant'));
    expect(result.current.hydrated).toBe(false);
  });
});
