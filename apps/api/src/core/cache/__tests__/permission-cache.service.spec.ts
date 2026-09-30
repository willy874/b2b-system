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

  describe('載入期間被失效', () => {
    it('取票之後被失效：載入結果不寫回，下一次請求重新查 DB', () => {
      const cache = createCache();
      const ticket = cache.ticket();
      // 撤銷權限的交易在這時提交並失效
      cache.invalidate('user-1');
      cache.set('user-1', value(['user:read']), ticket);
      expect(cache.get('user-1')).toBeUndefined();
    });

    it('失效發生在取票之前：照常寫入', () => {
      const cache = createCache();
      cache.invalidate('user-1');
      const ticket = cache.ticket();
      cache.set('user-1', value(['user:read']), ticket);
      expect(cache.get('user-1')).toBeDefined();
    });

    it('別人被失效不影響這一筆', () => {
      const cache = createCache();
      const ticket = cache.ticket();
      cache.invalidate('user-2');
      cache.set('user-1', value([]), ticket);
      expect(cache.get('user-1')).toBeDefined();
    });

    it('invalidateAll 之前取的票全部作廢', () => {
      const cache = createCache();
      const ticket = cache.ticket();
      cache.invalidateAll();
      cache.set('user-1', value([]), ticket);
      expect(cache.get('user-1')).toBeUndefined();
    });

    it('失效紀錄超過上限被擠掉時保守地不寫入', () => {
      const cache = createCache();
      const ticket = cache.ticket();
      for (let index = 0; index < 10_050; index += 1) cache.invalidate(`user-${index}`);
      cache.set('user-0', value([]), ticket);
      expect(cache.get('user-0')).toBeUndefined();
    });
  });

  it('super-admin 旗標被保留', () => {
    const cache = createCache();
    cache.set('root', value([], true));
    expect(cache.get('root')?.isSuperAdmin).toBe(true);
  });
});
