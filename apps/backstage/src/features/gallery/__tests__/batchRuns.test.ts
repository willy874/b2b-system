import { isAppError } from '@b2b-system/web-core/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pairItemId } from '@/core/upload';

import { galleryUploadSources } from '../batch';
import { deleteRun, tagRun, uploadRun } from '../batchRuns';

const { updateTags, uploadGalleryItem, deleteItem } = vi.hoisted(() => ({
  updateTags: vi.fn(),
  uploadGalleryItem: vi.fn(),
  deleteItem: vi.fn(),
}));
vi.mock('@/apis/tag/update-resource-tags/fetcher', () => ({
  fetchResourceTagsUpdateMutation: updateTags,
}));
vi.mock('@/apis/gallery/upload-gallery-item/fetcher', () => ({ uploadGalleryItem }));
vi.mock('@/apis/gallery/delete-gallery-item/fetcher', () => ({
  fetchGalleryItemDeleteMutation: deleteItem,
}));

const context = () => ({
  signal: new AbortController().signal,
  reportProgress: vi.fn(),
  invalidate: vi.fn(),
});

const png = () => new File(['png'], 'a.png', { type: 'image/png' });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('圖片庫的批次上傳（docs/architecture/frontend/24-gallery.md §4）', () => {
  it('以暫存檔與項目 id 帶的相簿上傳、回報進度；只宣告「處理中」的計數改了，結束後重抓已用量', async () => {
    const file = png();
    await galleryUploadSources.store.put('src-1', file);
    uploadGalleryItem.mockImplementation(
      async ({ onProgress }: { onProgress: (progress: unknown) => void }) => {
        onProgress({ loaded: 3, total: 3 });
        return { id: 'upload-1' };
      },
    );
    const ctx = context();

    await uploadRun(pairItemId('src-1', 'album-1'), ctx);

    expect(uploadGalleryItem).toHaveBeenCalledWith(
      expect.objectContaining({ file, albumId: 'album-1' }),
      ctx.signal,
    );
    expect(ctx.reportProgress).toHaveBeenCalledWith({ loaded: 3, total: 3 });
    // 還沒處理完、不在圖片庫：不宣告 create（處理完由伺服器推）
    expect(ctx.invalidate.mock.calls).toEqual([
      [[{ resource: 'galleryItem', kind: 'update' }]],
      [[{ resource: 'fileStorageUsage', kind: 'update' }]],
    ]);
    await expect(galleryUploadSources.store.get('src-1')).resolves.toBeUndefined();
  });

  it('沒有相簿：不帶 albumId；量不到尺寸（jsdom 沒有 createImageBitmap）就不帶寬高', async () => {
    await galleryUploadSources.store.put('src-2', png());
    uploadGalleryItem.mockResolvedValue({ id: 'upload-2' });

    await uploadRun('src-2', context());

    const [input] = uploadGalleryItem.mock.calls[0] as [Record<string, unknown>];
    expect(input.albumId).toBeUndefined();
    expect(input).not.toHaveProperty('width');
    expect(input).not.toHaveProperty('height');
  });

  it('瀏覽器量得到尺寸：帶上寬高（時間軸先排版的暫定值），並釋放 bitmap', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 640, height: 480, close })),
    );
    await galleryUploadSources.store.put('src-3', png());
    uploadGalleryItem.mockResolvedValue({ id: 'upload-3' });

    await uploadRun('src-3', context());

    expect(uploadGalleryItem).toHaveBeenCalledWith(
      expect.objectContaining({ width: 640, height: 480 }),
      expect.anything(),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('瀏覽器解碼失敗：照樣上傳、不帶寬高（以伺服器解碼的尺寸為準）', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('unsupported');
      }),
    );
    await galleryUploadSources.store.put('src-4', png());
    uploadGalleryItem.mockResolvedValue({ id: 'upload-4' });

    await uploadRun('src-4', context());

    const [input] = uploadGalleryItem.mock.calls[0] as [Record<string, unknown>];
    expect(input).not.toHaveProperty('width');
  });

  it('上傳失敗：不宣告圖片改了，但仍重抓已用量（登記就佔用了容量）', async () => {
    await galleryUploadSources.store.put('src-5', png());
    uploadGalleryItem.mockRejectedValue(new Error('boom'));
    const ctx = context();

    await expect(uploadRun('src-5', ctx)).rejects.toThrow('boom');

    expect(ctx.invalidate.mock.calls).toEqual([
      [[{ resource: 'fileStorageUsage', kind: 'update' }]],
    ]);
  });

  it('接手的分頁拿不到暫存檔 → GALLERY_UPLOAD_INCOMPLETE（請使用者重傳）', async () => {
    const error = await uploadRun('missing', context()).catch((reason: unknown) => reason);
    expect(isAppError(error) && error.code).toBe('GALLERY_UPLOAD_INCOMPLETE');
    expect(uploadGalleryItem).not.toHaveBeenCalled();
  });
});

describe('圖片庫的批次刪除', () => {
  it('呼叫單筆刪除，只宣告那一張刪除了', async () => {
    deleteItem.mockResolvedValue(undefined);
    const ctx = context();

    await deleteRun('item-9', ctx);

    expect(deleteItem).toHaveBeenCalledWith({ params: { itemId: 'item-9' }, signal: ctx.signal });
    expect(ctx.invalidate).toHaveBeenCalledWith([
      { resource: 'galleryItem', kind: 'delete', id: 'item-9' },
    ]);
  });

  it('刪除失敗：錯誤交給佇列，不宣告變更', async () => {
    deleteItem.mockRejectedValue(new Error('boom'));
    const ctx = context();

    await expect(deleteRun('item-9', ctx)).rejects.toThrow('boom');

    expect(ctx.invalidate).not.toHaveBeenCalled();
  });
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
    await tagRun('item-1', context());
    expect(updateTags).not.toHaveBeenCalled();
  });
});
