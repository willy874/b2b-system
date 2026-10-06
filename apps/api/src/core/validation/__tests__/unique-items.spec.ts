import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { uniqueItems } from '../unique-items';

describe('uniqueItems（陣列不可有重複值）', () => {
  const ids = uniqueItems(z.array(z.string()));

  it.each([
    ['空陣列', []],
    ['一個元素', ['a']],
    ['都不重複', ['a', 'b', 'c']],
  ])('接受：%s', (_name, value) => {
    expect(ids.safeParse(value)).toEqual({ success: true, data: value });
  });

  it.each([
    ['兩個相同', ['a', 'a']],
    ['不相鄰的重複', ['a', 'b', 'a']],
  ])('拒絕：%s', (_name, value) => {
    expect(ids.safeParse(value).success).toBe(false);
  });

  it('拒絕時的訊息是 duplicate items，路徑在陣列本身', () => {
    const result = ids.safeParse(['x', 'x']);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ message: 'duplicate items', path: [] }),
    ]);
  });

  it('數字陣列以值比較：1 與 1 重複', () => {
    expect(uniqueItems(z.array(z.number())).safeParse([1, 2, 1]).success).toBe(false);
  });

  it('元素本身的驗證仍然生效（不只檢查重複）', () => {
    expect(uniqueItems(z.array(z.uuid())).safeParse(['not-a-uuid']).success).toBe(false);
  });
});
