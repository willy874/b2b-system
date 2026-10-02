import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import { usePermissionStore } from '@/core/store';

import { registerTagPagePermissions } from '../../permission';
import { useTagPermission } from '../useTagPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerTagPagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useTagPermission（docs/adr/0032-tags.md D5）', () => {
  it('持有任一個管理鍵就進得了標籤管理', () => {
    hydrate([PermissionKey['tag:update']]);
    expect(renderHook(() => useTagPermission()).result.current).toMatchObject({
      canAccess: true,
      canCreate: false,
      canUpdate: true,
      canDelete: false,
    });
  });

  it('沒有任何 tag 鍵 → 進不了（貼標籤不需要權限鍵，不靠這一頁）', () => {
    hydrate([PermissionKey['user:update'], PermissionKey['file:access']]);
    expect(renderHook(() => useTagPermission()).result.current.canAccess).toBe(false);
  });
});
