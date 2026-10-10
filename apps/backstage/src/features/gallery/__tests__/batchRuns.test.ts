import { describe, expect, it, vi } from 'vitest';

import { pairItemId } from '@/core/upload';

import { tagRun } from '../batchRuns';

const { updateTags } = vi.hoisted(() => ({ updateTags: vi.fn() }));
vi.mock('@/apis/tag/update-resource-tags/fetcher', () => ({
  fetchResourceTagsUpdateMutation: updateTags,
}));

const context = () => ({
  signal: new AbortController().signal,
  reportProgress: vi.fn(),
  invalidate: vi.fn(),
});

describe('圖片庫的批次貼標籤（docs/architecture/frontend/24-gallery.md §5）', () => {
  it('以差異語意只加上這一個標籤，不先讀目前的標籤；宣告那一張改了', async () => {
    updateTags.mockResolvedValue({ tags: [] });
    const ctx = context();
    await tagRun(pairItemId('item-1', 'tag-1'), ctx);
    expect(updateTags).toHaveBeenCalledWith({
      params: { resourceType: 'galleryItem', resourceId: 'item-1', add: ['tag-1'] },
      signal: ctx.signal,
    });
    expect(ctx.invalidate).toHaveBeenCalledWith([
      { resource: 'galleryItem', kind: 'update', id: 'item-1' },
    ]);
  });

  it('id 沒有帶標籤：什麼都不做', async () => {
    updateTags.mockReset();
    await tagRun('item-1', context());
    expect(updateTags).not.toHaveBeenCalled();
  });
});
