import { describe, expect, it } from 'vitest';

import { crossedWarning, lastActivityAt, storageUsageRatio } from '../tenant-usage.service';

const MIB = 1024 * 1024;

describe('storageUsageRatio', () => {
  it.each([
    [512 * MIB, 1024 * MIB, 0.5],
    [2048 * MIB, 1024 * MIB, 2],
    [null, 1024 * MIB, null],
    [10, 0, null],
    [10, null, null],
  ])('%s ÷ %s → %s', (used, quota, expected) => {
    expect(storageUsageRatio(used, quota)).toBe(expected);
  });
});

/** 配額 100 的快照。 */
function at(used: number) {
  return { storageUsedBytes: used, storageQuotaBytes: 100 };
}

describe('crossedWarning（越過時通知一次，docs/architecture/05-tenancy.md §14.2 D8）', () => {
  it('從門檻以下到以上 → 通知', () => {
    expect(crossedWarning(at(79), at(80))).toBe(true);
  });

  it('第一次快照就在門檻以上 → 通知', () => {
    expect(crossedWarning(undefined, at(95))).toBe(true);
  });

  it('上一次已經在門檻以上 → 不重發', () => {
    expect(crossedWarning(at(85), at(90))).toBe(false);
  });

  it('仍在門檻以下 → 不通知', () => {
    expect(crossedWarning(at(10), at(79))).toBe(false);
  });

  it('回到門檻以下之後再越過 → 再通知一次', () => {
    expect(crossedWarning(at(70), at(81))).toBe(true);
  });

  it('沒有儲存量（沒有登記來源）→ 不通知', () => {
    expect(crossedWarning(undefined, { usersActive: 3 })).toBe(false);
  });
});

describe('lastActivityAt（docs/architecture/05-tenancy.md §14.2 D7）', () => {
  const login = new Date('2026-10-05T08:00:00.000Z');

  it('只有登入 → 最後登入', () => {
    expect(lastActivityAt(login, null)).toEqual(login);
  });

  it('只有對外 API → 那一天的 00:00 UTC', () => {
    expect(lastActivityAt(null, '2026-10-07')).toEqual(new Date('2026-10-07T00:00:00.000Z'));
  });

  it('兩者都有 → 取較晚者', () => {
    expect(lastActivityAt(login, '2026-10-07')).toEqual(new Date('2026-10-07T00:00:00.000Z'));
    expect(lastActivityAt(login, '2026-10-01')).toEqual(login);
  });

  it('都沒有 → null', () => {
    expect(lastActivityAt(null, null)).toBeNull();
  });
});
