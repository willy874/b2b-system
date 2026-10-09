import { describe, expect, it, vi } from 'vitest';

import type { CdnPurger, ObjectStorage } from '@/core/storage';

import { FileObjectsService } from '../file-objects.service';
import { storageKeyOf, thumbnailKeyOf, variantKeyOf } from '../file.constants';

const FILE_ID = '11111111-1111-4111-8111-111111111111';

function setup(keys: string[]) {
  const storage = {
    delete: vi.fn(async (_key: string) => undefined),
    async *listObjects(prefix: string) {
      for (const key of keys)
        if (key.startsWith(prefix)) yield { key, size: 1, lastModified: new Date() };
    },
  };
  const cdn = { schedule: vi.fn(async () => undefined) };
  const service = new FileObjectsService(
    storage as unknown as ObjectStorage,
    cdn as unknown as CdnPurger,
  );
  return { service, storage, cdn };
}

describe('FileObjectsService.deleteAll（永久刪除；docs/architecture/backend/09-file.md §16.6）', () => {
  it('刪掉原檔、縮圖、變體之後，只把變體排入邊緣快取的清理（原檔與縮圖不走 CDN）', async () => {
    const preview = variantKeyOf(FILE_ID, 'preview', 'jpeg');
    const avif = variantKeyOf(FILE_ID, 'thumbnail', 'avif');
    const { service, storage, cdn } = setup([preview, avif]);
    await service.deleteAll(FILE_ID);

    expect(storage.delete).toHaveBeenCalledWith(storageKeyOf(FILE_ID));
    expect(storage.delete).toHaveBeenCalledWith(thumbnailKeyOf(FILE_ID));
    expect(storage.delete).toHaveBeenCalledWith(preview);
    expect(cdn.schedule).toHaveBeenCalledWith([preview, avif]);
    // 先刪物件、再清快取
    const lastDelete = Math.max(...storage.delete.mock.invocationCallOrder);
    expect(cdn.schedule.mock.invocationCallOrder[0]).toBeGreaterThan(lastDelete);
  });

  it('變體刪除失敗 → 不排清理（物件還在，留給孤兒對帳刪掉之後再清）', async () => {
    const preview = variantKeyOf(FILE_ID, 'preview', 'jpeg');
    const { service, storage, cdn } = setup([preview]);
    storage.delete.mockImplementation(async (key: string) => {
      if (key === preview) throw new Error('down');
    });
    await service.deleteAll(FILE_ID);
    expect(cdn.schedule).not.toHaveBeenCalled();
  });

  it('已知沒有變體 → 不列出、不清理', async () => {
    const { service, cdn } = setup([]);
    await service.deleteAll(FILE_ID, { hasVariants: false });
    expect(cdn.schedule).not.toHaveBeenCalled();
  });
});
