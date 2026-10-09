import { describe, expect, it, vi } from 'vitest';

import type { CdnPathResolver } from '@/core/storage';
import type { GalleryItemRow } from '@/db/schema';

import { GalleryCdnPaths } from '../gallery-cdn-paths';
import type { GalleryItemRepository } from '../gallery-item.repository';
import { galleryCdnKeysOf } from '../gallery.constants';

const ID = '0f8c2f4e-7a51-4a8e-9a39-0b6f5b0d2c11';
const ROW = {
  id: ID,
  rev: 2,
  variants: {
    width: 800,
    height: 400,
    formats: ['jpeg', 'webp'],
    renditions: { thumb: { width: 480, height: 240 }, medium: { width: 800, height: 400 } },
  },
} as unknown as GalleryItemRow;

describe('GalleryCdnPaths（galleryItem 的路徑解析；docs/architecture/backend/09-file.md §16.11）', () => {
  it('在 onModuleInit 登記 galleryItem；列出每個版本的每個尺寸 × 格式（與 cli:cdn-purge 相同），找不到回 null', async () => {
    const register = vi.fn();
    const items = { findById: vi.fn(async (id: string) => (id === ID ? ROW : undefined)) };
    const paths = new GalleryCdnPaths(
      { register } as unknown as CdnPathResolver,
      items as unknown as GalleryItemRepository,
    );
    paths.onModuleInit();
    expect(register).toHaveBeenCalledWith('galleryItem', expect.any(Function));

    const keys = await paths.keysOf(ID);
    expect(keys).toEqual(galleryCdnKeysOf(ROW));
    expect(keys).toHaveLength(2 * 2 * 2);
    expect(keys?.every((key) => /^gallery\/[^/]+\/r[12]\//.test(key))).toBe(true);
    expect(await paths.keysOf('11111111-1111-4111-8111-111111111111')).toBeNull();
  });
});
