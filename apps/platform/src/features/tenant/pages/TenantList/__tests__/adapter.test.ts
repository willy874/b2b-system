import { describe, expect, it } from 'vitest';

import { toStorageTotalVM } from '../adapter';

const BASE = {
  usedBytes: 0,
  limitBytes: 1000,
  usageRatio: 0,
  warningRatio: 0.8,
  measuredAt: '2026-10-09T12:00:00.000Z',
  isStale: false,
};

describe('toStorageTotalVM（儲存的止水線，docs/architecture/backend/25-image.md §12）', () => {
  it('部署沒有啟用（limitBytes 是 null）：不顯示', () => {
    expect(toStorageTotalVM({ ...BASE, limitBytes: null, usageRatio: null })).toBeNull();
  });

  it.each([
    { usedBytes: 799, percent: 79, isWarning: false, isReached: false },
    { usedBytes: 800, percent: 80, isWarning: true, isReached: false },
    { usedBytes: 999, percent: 99, isWarning: true, isReached: false },
    { usedBytes: 1200, percent: 120, isWarning: true, isReached: true },
  ])('已用 $usedBytes / 1000 → $percent%（無條件捨去）', ({ usedBytes, ...expected }) => {
    expect(toStorageTotalVM({ ...BASE, usedBytes, usageRatio: usedBytes / 1000 })).toMatchObject(
      expected,
    );
  });

  it('量測時間轉成 Date；還沒量測過是 null', () => {
    expect(toStorageTotalVM(BASE)?.measuredAt).toEqual(new Date('2026-10-09T12:00:00.000Z'));
    expect(toStorageTotalVM({ ...BASE, measuredAt: null })?.measuredAt).toBeNull();
  });
});
