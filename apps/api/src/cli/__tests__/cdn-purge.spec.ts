import { describe, expect, it } from 'vitest';

import { galleryCdnKeysOf } from '@/modules/gallery/gallery.constants';
import { assetObjectKeysOf } from '@/modules/image/image.constants';

import { parseCdnPurgeArgs } from '../cdn-purge';

const ASSET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('cli:cdn-purge 的參數（docs/architecture/backend/09-file.md §16.7）', () => {
  it('--tenant ＋ 多個 --path：前面的 / 拿掉', () => {
    expect(
      parseCdnPurgeArgs([
        '--tenant',
        'acme',
        '--path',
        '/images/a/sm.webp',
        '--path',
        'variants/f/preview.jpeg',
      ]),
    ).toEqual({
      kind: 'paths',
      tenant: 'acme',
      keys: ['images/a/sm.webp', 'variants/f/preview.jpeg'],
      confirm: undefined,
    });
  });

  it('--tenant ＋ --image-asset；--all ＋ --confirm', () => {
    expect(parseCdnPurgeArgs(['--tenant', 'acme', '--image-asset', ASSET])).toMatchObject({
      kind: 'imageAsset',
      assetId: ASSET,
    });
    expect(parseCdnPurgeArgs(['--tenant', 'acme', '--gallery-item', ASSET])).toMatchObject({
      kind: 'galleryItem',
      itemId: ASSET,
    });
    expect(parseCdnPurgeArgs(['--all', '--confirm', 'b2b_platform'])).toEqual({
      kind: 'all',
      confirm: 'b2b_platform',
    });
  });

  it.each([
    [[], '缺少 --tenant'],
    [['--tenant', 'acme'], '要指定其中一種'],
    [['--tenant', 'acme', '--path', 'a', '--image-asset', ASSET], '要指定其中一種'],
    [['--all', '--tenant', 'acme'], '--all 不能'],
    [['--tenant', 'acme', '--image-asset', 'not-a-uuid'], 'uuid'],
    [['--tenant', 'acme', '--gallery-item', 'not-a-uuid'], 'uuid'],
    [['--tenant', 'acme', '--image-asset', ASSET, '--gallery-item', ASSET], '要指定其中一種'],
    [['--tenant', 'acme', '--path', 'images/../../other-bucket/x'], '不合法'],
  ])('%j → 拋錯（%s）', (argv, message) => {
    expect(() => parseCdnPurgeArgs(argv)).toThrow(message);
  });
});

describe('assetObjectKeysOf（圖片資產可能由 CDN 送出過的物件）', () => {
  it('主檔，與每個版本的每個尺寸 × 格式；與另一個尺寸相同的（sameAs）不重複列', () => {
    expect(
      assetObjectKeysOf({
        id: ASSET,
        rev: 2,
        masterFormat: 'jpeg',
        variants: {
          width: 512,
          height: 512,
          formats: ['jpeg', 'webp'],
          renditions: {
            sm: { width: 32, height: 32 },
            'sm@2x': { width: 64, height: 64, sameAs: 'md' },
          },
        },
      }),
    ).toEqual([
      `images/${ASSET}/master.jpg`,
      `images/${ASSET}/r1/sm.jpg`,
      `images/${ASSET}/r1/sm.webp`,
      `images/${ASSET}/r2/sm.jpg`,
      `images/${ASSET}/r2/sm.webp`,
    ]);
  });
});

describe('galleryCdnKeysOf（圖片庫可能由 CDN 送出過的物件）', () => {
  it('每個版本的每個尺寸 × 格式；sameAs 不重複列；原檔不列', () => {
    expect(
      galleryCdnKeysOf({
        id: ASSET,
        rev: 2,
        variants: {
          width: 800,
          height: 400,
          formats: ['jpeg', 'webp'],
          renditions: {
            thumb: { width: 480, height: 240 },
            medium: { width: 800, height: 400 },
            large: { width: 800, height: 400, sameAs: 'medium' },
          },
        },
      }),
    ).toEqual([
      `gallery/${ASSET}/r1/thumb.jpg`,
      `gallery/${ASSET}/r1/thumb.webp`,
      `gallery/${ASSET}/r1/medium.jpg`,
      `gallery/${ASSET}/r1/medium.webp`,
      `gallery/${ASSET}/r2/thumb.jpg`,
      `gallery/${ASSET}/r2/thumb.webp`,
      `gallery/${ASSET}/r2/medium.jpg`,
      `gallery/${ASSET}/r2/medium.webp`,
    ]);
    expect(galleryCdnKeysOf({ id: ASSET, rev: 1, variants: null })).toEqual([]);
  });
});
