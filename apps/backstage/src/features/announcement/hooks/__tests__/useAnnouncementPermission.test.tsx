import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import { usePermissionStore } from '@/core/store';

import { registerAnnouncementPagePermissions } from '../../permission';
import { useAnnouncementPermission } from '../useAnnouncementPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerAnnouncementPagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useAnnouncementPermission（docs/architecture/backend/19-announcement.md §9.2 D15）', () => {
  it('auditor（只有 announcement:read）只能看', () => {
    hydrate([PermissionKey['announcement:read']]);
    expect(renderHook(() => useAnnouncementPermission()).result.current).toMatchObject({
      canAccess: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canPublish: false,
    });
  });

  it('能寫草稿的人不一定能發送：update 沒有帶來 publish', () => {
    hydrate([
      PermissionKey['announcement:read'],
      PermissionKey['announcement:create'],
      PermissionKey['announcement:update'],
    ]);
    expect(renderHook(() => useAnnouncementPermission()).result.current).toMatchObject({
      canCreate: true,
      canUpdate: true,
      canPublish: false,
    });
  });

  it('announcement:publish → canPublish', () => {
    hydrate([PermissionKey['announcement:read'], PermissionKey['announcement:publish']]);
    expect(renderHook(() => useAnnouncementPermission()).result.current.canPublish).toBe(true);
  });

  it('沒有 announcement:read：進不了列表頁', () => {
    hydrate([PermissionKey['user:read']]);
    expect(renderHook(() => useAnnouncementPermission()).result.current.canAccess).toBe(false);
  });
});
