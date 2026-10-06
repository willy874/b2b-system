import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePermissionStore } from '../../store/permission';
import { definePageKey, PermissionMatch } from '../constants';
import { usePageAccessChecker, usePagePermission, usePermission } from '../hooks';
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
