import { describe, expect, it } from 'vitest';

import { toTrashRowVM } from '../adapter';

const ITEM = {
  id: 'u-1',
  type: 'user' as const,
  name: 'Alice',
  description: null,
  deletedAt: '2026-09-30T00:00:00.000Z',
  deletedBy: null,
  purgeAt: '2026-10-30T00:00:00.000Z',
};

describe('toTrashRowVM', () => {
  it('沒有刪除者（系統刪除或已被永久刪除）顯示 -，沒有描述是空字串', () => {
    const row = toTrashRowVM(ITEM);
    expect(row.deletedBy).toBe('-');
    expect(row.description).toBe('');
  });

  it('帶刪除者的名稱與格式化的時間', () => {
    const row = toTrashRowVM({ ...ITEM, deletedBy: { id: 'a', name: 'Admin' } });
    expect(row.deletedBy).toBe('Admin');
    expect(row.deletedAt).not.toBe(ITEM.deletedAt);
    expect(row.purgeAt).toMatch(/2026/);
  });
});
