import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { registerTrashType, resetTrashRegistry } from '@/core/trash';

import { useTrashPermission } from '../useTrashPermission';

function hydrate(keys: string[] | 'unhydrated'): void {
  usePermissionStore.setState(
    keys === 'unhydrated'
      ? { permissions: new Set(), hydrated: false }
      : { permissions: new Set(keys as PermissionKey[]), hydrated: true },
  );
}

describe('useTrashPermission（回收桶頁的權限 facade）', () => {
  beforeEach(() => {
    resetTrashRegistry();
    registerTrashType({
      type: 'user',
      order: 10,
      labelI18nKey: 'menu.user',
      permission: 'user:delete' as PermissionKey,
      RestoreAction: () => null,
    });
  });

  it('只列出持有該類型權限（<resource>:delete）的類型', () => {
    hydrate(['user:delete']);
    const { result } = renderHook(() => useTrashPermission());
    expect(result.current.types.map((type) => type.type)).toEqual(['user']);
  });

  it('沒有 user:delete → 看不到使用者分頁', () => {
    hydrate(['user:read']);
    const { result } = renderHook(() => useTrashPermission());
    expect(result.current.types).toEqual([]);
  });

  it('權限未水合 → 沒有任何分頁（不閃現）', () => {
    hydrate('unhydrated');
    const { result } = renderHook(() => useTrashPermission());
    expect(result.current).toEqual({ hydrated: false, types: [] });
  });
});
