import { describe, expect, it, vi } from 'vitest';

import { fetchAllPages } from '../fetchAllPages';

const page = (from: number, count: number, total: number) => ({
  items: Array.from({ length: count }, (_, index) => from + index),
  pagination: { total },
});

describe('fetchAllPages（docs/architecture/frontend/07-ui-system.md §6.1）', () => {
  it('依序取完所有分頁', async () => {
    const fetchPage = vi.fn((offset: number, limit: number) =>
      Promise.resolve(page(offset, Math.min(limit, 450 - offset), 450)),
    );
    const result = await fetchAllPages(fetchPage);
    expect(result.items).toHaveLength(450);
    expect(result.pagination.total).toBe(450);
    expect(fetchPage.mock.calls).toEqual([
      [0, 200],
      [200, 200],
      [400, 200],
    ]);
  });

  it('只有一頁時只請求一次', async () => {
    const fetchPage = vi.fn(() => Promise.resolve(page(0, 3, 3)));
    expect((await fetchAllPages(fetchPage)).items).toEqual([0, 1, 2]);
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it('頁面比預期短就停，到達上限也停', async () => {
    const short = vi.fn(() => Promise.resolve(page(0, 150, 400)));
    await fetchAllPages(short);
    expect(short).toHaveBeenCalledOnce();

    const endless = vi.fn((offset: number, limit: number) =>
      Promise.resolve(page(offset, limit, 10_000)),
    );
    const result = await fetchAllPages(endless, { maxItems: 400 });
    expect(result.items).toHaveLength(400);
    expect(endless).toHaveBeenCalledTimes(2);
  });
});
