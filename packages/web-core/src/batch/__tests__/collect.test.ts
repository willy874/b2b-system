import { describe, expect, it, vi } from 'vitest';

import { collectAllPages } from '../collect';

function source(total: number) {
  const rows = Array.from({ length: total }, (_, index) => ({ id: String(index) }));
  return vi.fn(async (offset: number, limit: number) => ({
    items: rows.slice(offset, offset + limit),
    total,
  }));
}

describe('collectAllPages（docs/architecture/frontend/07-ui-system.md §13.7）', () => {
  it('逐頁取到最後一頁，依序回報進度', async () => {
    const fetchPage = source(450);
    const onProgress = vi.fn();
    const rows = await collectAllPages({
      fetchPage,
      signal: new AbortController().signal,
      onProgress,
    });
    expect(rows).toHaveLength(450);
    expect(rows[449]).toEqual({ id: '449' });
    expect(fetchPage.mock.calls.map(([offset, limit]) => [offset, limit])).toEqual([
      [0, 200],
      [200, 200],
      [400, 200],
    ]);
    expect(onProgress.mock.calls).toEqual([
      [200, 450],
      [400, 450],
      [450, 450],
    ]);
  });

  it('到上限就停：最後一頁只取剩下的筆數', async () => {
    const fetchPage = source(1000);
    const rows = await collectAllPages({
      fetchPage,
      signal: new AbortController().signal,
      max: 450,
    });
    expect(rows).toHaveLength(450);
    expect(fetchPage).toHaveBeenLastCalledWith(400, 50, expect.anything());
  });

  it('資料在收集期間變少：不滿一頁就結束', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: Array.from({ length: 200 }, () => ({})), total: 500 })
      .mockResolvedValueOnce({ items: Array.from({ length: 10 }, () => ({})), total: 210 });
    const rows = await collectAllPages({ fetchPage, signal: new AbortController().signal });
    expect(rows).toHaveLength(210);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('中止：拋出 reason，不再取下一頁', async () => {
    const controller = new AbortController();
    const fetchPage = vi.fn(async (offset: number, limit: number) => {
      if (offset === 200) controller.abort(new Error('stop'));
      return { items: Array.from({ length: limit }, () => ({})), total: 1000 };
    });
    await expect(collectAllPages({ fetchPage, signal: controller.signal })).rejects.toThrow('stop');
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
