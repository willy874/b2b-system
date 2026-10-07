import { describe, expect, it } from 'vitest';

import { PasswordHasher } from '../password-hasher';

function hasher(overrides: Record<string, number> = {}): PasswordHasher {
  const values: Record<string, number> = {
    // 測試用的小參數：只驗並行與排隊的行為
    ARGON2_MEMORY_COST: 1024,
    ARGON2_TIME_COST: 1,
    ARGON2_MAX_CONCURRENCY: 4,
    ARGON2_MAX_QUEUE: 32,
    ARGON2_QUEUE_TIMEOUT_MS: 3000,
    ...overrides,
  };
  return new PasswordHasher({ get: (key: string) => values[key] } as never);
}

describe('PasswordHasher（docs/architecture/backend/04-auth.md §4.1）', () => {
  it('雜湊與驗證照常運作，參數讀 ARGON2_*', async () => {
    const passwords = hasher();
    const hash = await passwords.hash('Quiet-Harbor-Lantern-26');
    expect(hash).toContain('m=1024,t=1');
    await expect(passwords.verify(hash, 'Quiet-Harbor-Lantern-26')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'wrong')).resolves.toBe(false);
    await expect(passwords.verifyAgainstDummy('anything')).resolves.toBe(false);
  });

  it('名額與等待都滿了 → 503 AUTH_BUSY（帶建議的等待秒數），其他請求不受影響', async () => {
    const passwords = hasher({ ARGON2_MAX_CONCURRENCY: 1, ARGON2_MAX_QUEUE: 1 });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => passwords.hash('Quiet-Harbor-Lantern-26')),
    );
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(rejected).toHaveLength(3);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'AUTH_BUSY',
      details: { retryAfterSeconds: 2 },
    });
  });
});
