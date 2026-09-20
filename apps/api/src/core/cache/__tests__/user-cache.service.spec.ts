import { describe, expect, it, vi } from 'vitest';

import { UserCacheService } from '../user-cache.service';

const user = {
  id: 'user-1',
  email: 'a@example.com',
  status: 'active' as const,
  tokenVersion: 0,
  deletedAt: null,
};

describe('UserCacheService', () => {
  it('30 秒內命中', () => {
    const cache = new UserCacheService();
    cache.set(user);
    expect(cache.get('user-1')?.email).toBe('a@example.com');
  });

  it('逾時後 miss', () => {
    vi.useFakeTimers();
    const cache = new UserCacheService();
    cache.set(user);
    vi.advanceTimersByTime(31_000);
    expect(cache.get('user-1')).toBeUndefined();
    vi.useRealTimers();
  });

  it('使用者被更新時主動失效', () => {
    const cache = new UserCacheService();
    cache.set(user);
    cache.invalidate('user-1');
    expect(cache.get('user-1')).toBeUndefined();
  });

  it('invalidateAll 清空（例如權限目錄變更）', () => {
    const cache = new UserCacheService();
    cache.set(user);
    cache.set({ ...user, id: 'user-2' });
    cache.invalidateAll();
    expect(cache.get('user-1')).toBeUndefined();
    expect(cache.get('user-2')).toBeUndefined();
  });

  it('同一個 id 重複 set 只是覆寫，不會被當成新項目', () => {
    const cache = new UserCacheService();
    cache.set(user);
    cache.set({ ...user, email: 'b@example.com' });
    expect(cache.get('user-1')?.email).toBe('b@example.com');
  });

  it('超過上限時淘汰最舊的一筆', () => {
    const cache = new UserCacheService();
    for (let index = 0; index < 10_050; index += 1) {
      cache.set({ ...user, id: `user-${index}` });
    }
    expect(cache.get('user-0')).toBeUndefined();
    expect(cache.get('user-10049')).toBeDefined();
  });
});
