import { describe, expect, it } from 'vitest';

import { hitOrAllow, MemoryRateLimitStore } from '../rate-limit-store';
import type { RateLimitStore } from '../rate-limit-store';

describe('hitOrAllow（docs/architecture/01-system.md §7 D6）', () => {
  it('正常時回傳計數', async () => {
    const store = new MemoryRateLimitStore();
    try {
      await hitOrAllow(store, 'k', 60_000);
      expect((await hitOrAllow(store, 'k', 60_000))?.count).toBe(2);
    } finally {
      store.onModuleDestroy();
    }
  });

  it('計數失敗時回 undefined（放行），不拋錯', async () => {
    const failing = { hit: () => Promise.reject(new Error('down')) } as unknown as RateLimitStore;
    await expect(hitOrAllow(failing, 'k', 60_000)).resolves.toBeUndefined();
  });
});
