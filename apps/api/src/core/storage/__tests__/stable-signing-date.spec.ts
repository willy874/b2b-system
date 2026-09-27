import { describe, expect, it } from 'vitest';

import { stableSigningDate } from '../object-storage';

describe('stableSigningDate（下載網址在時間窗內不變）', () => {
  it('同一個時間窗內取整到同一個時間', () => {
    const base = Date.UTC(2026, 8, 27, 0, 0, 0);
    expect(stableSigningDate(base + 1_000, 900)).toEqual(stableSigningDate(base + 400_000, 900));
  });

  it('剩餘效期介於 expiresIn / 2 與 expiresIn 之間', () => {
    const now = Date.UTC(2026, 8, 27, 0, 7, 29);
    const signedAt = stableSigningDate(now, 900).getTime();
    const remaining = signedAt + 900_000 - now;
    expect(remaining).toBeGreaterThanOrEqual(450_000);
    expect(remaining).toBeLessThanOrEqual(900_000);
  });
});
