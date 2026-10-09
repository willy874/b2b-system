import { describe, expect, it, vi } from 'vitest';

import type { ImageObjectSet, ImageUrlService } from '@/core/image';
import type { ObjectUrlSigner } from '@/core/storage';
import type { GalleryItemRow } from '@/db/schema';

import { GalleryImageUrls } from '../gallery-image-urls';
import { cdnKeysOf } from '../gallery.constants';

const ID = '0f8c2f4e-7a51-4a8e-9a39-0b6f5b0d2c11';

function row(overrides: Partial<GalleryItemRow> = {}): GalleryItemRow {
  return {
    id: ID,
    title: 'photo',
    contentType: 'image/jpeg',
    width: 800,
    height: 400,
    hasOriginal: true,
    displayRotation: 0,
    rev: 2,
    variantRev: 2,
    variants: {
      width: 800,
      height: 400,
      formats: ['jpeg', 'webp'],
      renditions: { thumb: { width: 480, height: 240 }, medium: { width: 800, height: 400 } },
    },
    ...overrides,
  } as GalleryItemRow;
}

describe('cdnKeysOf（docs/architecture/backend/26-gallery.md §11.5）', () => {
  it('只留變體（r<rev>/），原檔與上傳的暫存從不經過 CDN', () => {
    expect(
      cdnKeysOf([
        `gallery/${ID}/upload`,
        `gallery/${ID}/original`,
        `gallery/${ID}/r1/thumb.jpg`,
        `gallery/${ID}/r3/medium.webp`,
        'images/other/r1/sm.jpg',
      ]),
    ).toEqual([`gallery/${ID}/r1/thumb.jpg`, `gallery/${ID}/r3/medium.webp`]);
  });
});

describe('GalleryImageUrls 的 CDN 標記（docs/architecture/backend/09-file.md §16）', () => {
  it('變體的集合標 cdn: galleryItem；原檔的 inline 與下載不標', async () => {
    const sources = vi.fn(async (_set: ImageObjectSet) => ({
      width: 800,
      height: 400,
      variants: {},
    }));
    const sign = vi.fn(async (_key: string, _options: Record<string, unknown>) => ({
      url: 'https://storage.test/x',
      expiresAt: new Date('2026-10-09T00:00:00Z'),
    }));
    const urls = new GalleryImageUrls(
      { sources } as unknown as ImageUrlService,
      { sign } as unknown as ObjectUrlSigner,
    );

    await urls.sourcesOf(row());
    expect(sources.mock.calls[0]?.[0]).toMatchObject({
      keyPrefix: `gallery/${ID}/r2`,
      cdn: 'galleryItem',
    });

    await urls.originalOf(row());
    await urls.downloadsOf(row());
    expect(sign).toHaveBeenCalledTimes(3);
    for (const [, options] of sign.mock.calls) expect(options).not.toHaveProperty('cdn');
  });
});

describe('GalleryImageUrls.originalOf（檢視器放大超過 large 時的原檔，docs/architecture/backend/26-gallery.md §6）', () => {
  const sign = vi.fn(async (_key: string, _options: Record<string, unknown>) => ({
    url: 'https://storage.test/original',
    expiresAt: new Date('2026-10-09T00:00:00Z'),
  }));
  const urls = new GalleryImageUrls({} as ImageUrlService, { sign } as unknown as ObjectUrlSigner);

  it('沒有轉向、瀏覽器顯示得了：簽原檔的 inline 網址，尺寸是 EXIF 轉正之後的', async () => {
    await expect(urls.originalOf(row())).resolves.toMatchObject({
      url: 'https://storage.test/original',
      width: 800,
      height: 400,
    });
    expect(sign).toHaveBeenLastCalledWith(`gallery/${ID}/original`, expect.any(Object));
  });

  it.each([
    ['調整過顯示方向（原檔沒有轉）', { displayRotation: 90 }],
    ['TIFF（瀏覽器顯示不了）', { contentType: 'image/tiff' }],
    ['原檔還沒寫好', { hasOriginal: false }],
  ] as const)('%s：null，檢視器停在 large', async (_label, overrides) => {
    await expect(urls.originalOf(row(overrides))).resolves.toBeNull();
  });
});
