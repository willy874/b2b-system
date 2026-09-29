import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/db/seeds/permissions';

import { PermissionCacheService } from '../permission-cache.service';

function createCache(ttlSeconds = 60): PermissionCacheService {
  const config = { get: () => ttlSeconds } as unknown as ConfigService<never, true>;
  return new PermissionCacheService(config as never);
}

const value = (keys: PermissionKey[], isSuperAdmin = false) => ({
  permissions: new Set(keys),
  isSuperAdmin,
  canEnter: true,
});

describe('PermissionCacheService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('命中時回傳同一份集合', () => {
    const cache = createCache();
    cache.set('user-1', value(['role:read']));
    expect(cache.get('user-1')?.permissions.has('role:read')).toBe(true);
  });

  it('TTL 過期後視為 miss 並刪除該筆', () => {
    vi.useFakeTimers();
    const cache = createCache(60);
    cache.set('user-1', value(['role:read']));
    vi.advanceTimersByTime(61_000);
    expect(cache.get('user-1')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('invalidate 只清掉指定的使用者', () => {
    const cache = createCache();
    cache.set('user-1', value(['role:read']));
    cache.set('user-2', value(['user:read']));
    cache.invalidate('user-1');
    expect(cache.get('user-1')).toBeUndefined();
    expect(cache.get('user-2')).toBeDefined();
  });

  it('invalidateMany 清掉一整批（角色權限變更的用法）', () => {
    const cache = createCache();
    cache.set('user-1', value([]));
    cache.set('user-2', value([]));
    cache.set('user-3', value([]));
    cache.invalidateMany(['user-1', 'user-3']);
    expect(cache.get('user-1')).toBeUndefined();
    expect(cache.get('user-2')).toBeDefined();
    expect(cache.get('user-3')).toBeUndefined();
  });

  it('invalidateAll 清空（權限目錄變更的用法）', () => {
    const cache = createCache();
    cache.set('user-1', value([]));
    cache.set('user-2', value([]));
    cache.invalidateAll();
    expect(cache.size).toBe(0);
  });

  it('超過上限時淘汰最舊的一筆，不會無限成長', () => {
    const cache = createCache();
    for (let index = 0; index < 10_050; index += 1) cache.set(`user-${index}`, value([]));
    expect(cache.size).toBeLessThanOrEqual(10_000);
  });

  it('super-admin 旗標被保留', () => {
    const cache = createCache();
    cache.set('root', value([], true));
    expect(cache.get('root')?.isSuperAdmin).toBe(true);
  });

  it('平台與各工作區分開快取（docs/adr/0018-workspace-tenancy.md D15）', () => {
    const cache = createCache();
    cache.set('user-1', value(['user:read']));
    cache.set('user-1', value(['file:read']), 'ws-a');
    expect(cache.get('user-1')?.permissions.has('user:read')).toBe(true);
    expect(cache.get('user-1', 'ws-a')?.permissions.has('file:read')).toBe(true);
    expect(cache.get('user-1', 'ws-b')).toBeUndefined();
  });

  it('invalidate 清掉這個人在所有範圍的項目', () => {
    const cache = createCache();
    cache.set('user-1', value([]));
    cache.set('user-1', value([]), 'ws-a');
    cache.set('user-2', value([]), 'ws-a');
    cache.invalidate('user-1');
    expect(cache.get('user-1')).toBeUndefined();
    expect(cache.get('user-1', 'ws-a')).toBeUndefined();
    expect(cache.get('user-2', 'ws-a')).toBeDefined();
  });

  it('invalidateWorkspace 只清掉那個工作區（工作區刪除的用法）', () => {
    const cache = createCache();
    cache.set('user-1', value([]));
    cache.set('user-1', value([]), 'ws-a');
    cache.set('user-2', value([]), 'ws-a');
    cache.set('user-2', value([]), 'ws-b');
    cache.invalidateWorkspace('ws-a');
    expect(cache.get('user-1')).toBeDefined();
    expect(cache.get('user-1', 'ws-a')).toBeUndefined();
    expect(cache.get('user-2', 'ws-a')).toBeUndefined();
    expect(cache.get('user-2', 'ws-b')).toBeDefined();
    expect(cache.size).toBe(2);
  });
});
