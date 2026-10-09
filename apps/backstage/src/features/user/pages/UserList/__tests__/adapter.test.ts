import { describe, expect, it } from 'vitest';

import type { User } from '@/shared/api-sdk';

import { toUserRowVM } from '../adapter';

const user: User = {
  id: 'user-1',
  email: 'alice@example.com',
  username: null,
  displayName: 'Alice',
  avatar: null,
  avatarImageId: null,
  status: 'active',
  roles: [],
  tags: [],
  locale: 'zh-TW',
  timezone: 'Asia/Taipei',
  lastLoginAt: null,
  lockedUntil: null,
  mfaEnabled: false,
  version: 1,
  createdAt: '2026-09-19T02:10:00.000Z',
  updatedAt: '2026-09-19T02:10:00.000Z',
};

const fullAccess = { canDelete: true, canUpdate: true, canUnlock: true };

describe('toUserRowVM', () => {
  it('沒有 username 時顯示 -', () => {
    expect(toUserRowVM(user, fullAccess, 'someone-else').username).toBe('-');
  });

  it('不能刪除或編輯自己', () => {
    const vm = toUserRowVM(user, fullAccess, 'user-1');
    expect(vm.isSelf).toBe(true);
    expect(vm.canDelete).toBe(false);
    expect(vm.canUpdate).toBe(false);
  });

  it('別人的帳號在有權限時可刪除', () => {
    expect(toUserRowVM(user, fullAccess, 'other').canDelete).toBe(true);
  });

  it('只有 locked 狀態才顯示解鎖', () => {
    expect(toUserRowVM(user, fullAccess, 'other').canUnlock).toBe(false);
    expect(toUserRowVM({ ...user, status: 'locked' }, fullAccess, 'other').canUnlock).toBe(true);
  });

  it('lastLoginAt 為 null 時保持 null', () => {
    expect(toUserRowVM(user, fullAccess, 'other').lastLoginAt).toBeNull();
  });
});
