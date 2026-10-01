import { describe, expect, it, vi } from 'vitest';

import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';

import { BroadcastHub, flushBroadcast } from '../../broadcast/__tests__/broadcast-hub';
import { USER_CACHE_CHANNEL, UserCacheService } from '../user-cache.service';

function newCache(): UserCacheService {
  return new UserCacheService(new BroadcastHub().instance());
}

/** 扮演一個程序：已初始化、開始監聽。 */
async function processOn(hub: BroadcastHub): Promise<UserCacheService> {
  const broadcast = hub.instance();
  const cache = new UserCacheService(broadcast);
  cache.onModuleInit();
  await broadcast.onApplicationBootstrap();
  return cache;
}

function inTenant<T>(id: string, fn: () => T): T {
  return runInTenantContext({ id } as unknown as TenantContext, fn);
}

const user = {
  id: 'user-1',
  email: 'a@example.com',
  status: 'active' as const,
  tokenVersion: 0,
  deletedAt: null,
};

describe('UserCacheService', () => {
  it('30 秒內命中', () => {
    const cache = newCache();
    cache.set(user);
    expect(cache.get('user-1')?.email).toBe('a@example.com');
  });

  it('逾時後 miss', () => {
    vi.useFakeTimers();
    const cache = newCache();
    cache.set(user);
    vi.advanceTimersByTime(31_000);
    expect(cache.get('user-1')).toBeUndefined();
    vi.useRealTimers();
  });

  it('使用者被更新時主動失效', () => {
    const cache = newCache();
    cache.set(user);
    cache.invalidate('user-1');
    expect(cache.get('user-1')).toBeUndefined();
  });

  it('invalidateAll 清空（例如權限目錄變更）', () => {
    const cache = newCache();
    cache.set(user);
    cache.set({ ...user, id: 'user-2' });
    cache.invalidateAll();
    expect(cache.get('user-1')).toBeUndefined();
    expect(cache.get('user-2')).toBeUndefined();
  });

  it('同一個 id 重複 set 只是覆寫，不會被當成新項目', () => {
    const cache = newCache();
    cache.set(user);
    cache.set({ ...user, email: 'b@example.com' });
    expect(cache.get('user-1')?.email).toBe('b@example.com');
  });

  it('載入期間被失效（停用）時，舊的 active 不寫回快取', () => {
    const cache = newCache();
    const ticket = cache.ticket();
    cache.invalidate('user-1');
    cache.set(user, ticket);
    expect(cache.get('user-1')).toBeUndefined();
    cache.set(user, cache.ticket());
    expect(cache.get('user-1')).toBeDefined();
  });

  it('超過上限時淘汰最舊的一筆', () => {
    const cache = newCache();
    for (let index = 0; index < 10_050; index += 1) {
      cache.set({ ...user, id: `user-${index}` });
    }
    expect(cache.get('user-0')).toBeUndefined();
    expect(cache.get('user-10049')).toBeDefined();
  });

  describe('跨程序的失效（docs/adr/0027-api-tokens-external-api.md D16）', () => {
    it('一個程序失效，另一個程序的同一個租戶、同一個人也失效', async () => {
      const hub = new BroadcastHub();
      const [a, b] = [await processOn(hub), await processOn(hub)];
      inTenant('t1', () => b.set(user));

      inTenant('t1', () => a.invalidate('user-1'));
      await flushBroadcast();

      expect(inTenant('t1', () => b.get('user-1'))).toBeUndefined();
    });

    it('只失效同一個租戶：別的租戶的同一個 id 不受影響', async () => {
      const hub = new BroadcastHub();
      const [a, b] = [await processOn(hub), await processOn(hub)];
      inTenant('t2', () => b.set(user));

      inTenant('t1', () => a.invalidate('user-1'));
      await flushBroadcast();

      expect(inTenant('t2', () => b.get('user-1'))?.email).toBe('a@example.com');
    });

    it('平台管理者（沒有租戶脈絡）同樣廣播', async () => {
      const hub = new BroadcastHub();
      const [a, b] = [await processOn(hub), await processOn(hub)];
      b.set(user);

      a.invalidate('user-1');
      await flushBroadcast();

      expect(b.get('user-1')).toBeUndefined();
      expect(hub.messages(USER_CACHE_CHANNEL)).toEqual([{ tenant: null, users: ['user-1'] }]);
    });

    it('同一輪的多次失效合併成一則廣播；超過 150 個 id 才拆開', async () => {
      const hub = new BroadcastHub();
      const a = await processOn(hub);

      inTenant('t1', () => {
        for (let index = 0; index < 160; index += 1) a.invalidate(`user-${index}`);
      });
      await flushBroadcast();

      const messages = hub.messages(USER_CACHE_CHANNEL) as Array<{ users: string[] }>;
      expect(messages.map((message) => message.users.length)).toEqual([150, 10]);
    });

    it('監聽連線重連：中間可能漏了訊息，整個快取丟掉', async () => {
      const hub = new BroadcastHub();
      const b = await processOn(hub);
      inTenant('t1', () => b.set(user));

      hub.reconnect();
      await flushBroadcast();

      expect(inTenant('t1', () => b.get('user-1'))).toBeUndefined();
    });
  });
});
