import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import { usePermissionStore } from '@/core/store';

import { registerWebhookPagePermissions } from '../../permission';
import { useWebhookPermission } from '../useWebhookPermission';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerWebhookPagePermissions();
});

function hydrate(keys: PermissionKey[]): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated: true });
}

describe('useWebhookPermission（docs/adr/0030-webhooks.md D6）', () => {
  it('auditor（只有 webhook:read）只能看：不能建立、編輯、送出、刪除', () => {
    hydrate([PermissionKey['webhook:read']]);
    expect(renderHook(() => useWebhookPermission()).result.current).toMatchObject({
      canAccess: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canSend: false,
      canRotateSecret: false,
    });
  });

  it('webhook:update：能編輯、輪替密鑰、送測試事件與重送', () => {
    hydrate([PermissionKey['webhook:read'], PermissionKey['webhook:update']]);
    expect(renderHook(() => useWebhookPermission()).result.current).toMatchObject({
      canUpdate: true,
      canSend: true,
      canRotateSecret: true,
      canCreate: false,
    });
  });

  it('沒有 webhook:read：進不了頁面', () => {
    hydrate([PermissionKey['user:read']]);
    expect(renderHook(() => useWebhookPermission()).result.current.canAccess).toBe(false);
  });
});
