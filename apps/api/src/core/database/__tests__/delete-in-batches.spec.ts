import { describe, expect, it, vi } from 'vitest';

import { deleteInBatches } from '../delete-in-batches';

describe('deleteInBatches', () => {
  it('一批刪滿就再刪下一批，刪不滿才停；回傳總筆數', async () => {
    const remaining = [3, 3, 1];
    const deleteBatch = vi.fn(async (size: number) => {
      expect(size).toBe(3);
      return remaining.shift() ?? 0;
    });
    await expect(deleteInBatches(deleteBatch, 3)).resolves.toBe(7);
    expect(deleteBatch).toHaveBeenCalledTimes(3);
  });

  it('剛好刪完的那一批是滿的：再刪一次（0 筆）才停', async () => {
    const remaining = [2, 0];
    const deleteBatch = vi.fn(async () => remaining.shift() ?? 0);
    await expect(deleteInBatches(deleteBatch, 2)).resolves.toBe(2);
    expect(deleteBatch).toHaveBeenCalledTimes(2);
  });
});
