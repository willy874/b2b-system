import { describe, expect, it, vi } from 'vitest';

import type { ObjectUrlSigner, SignObjectUrlOptions } from '../../storage';
import { densityLayouts, ImageSourcesSchema, ImageUrlService } from '../image-url.service';
import type { ImageObjectSet } from '../image-url.service';

const EXPIRES_AT = new Date('2026-10-09T12:00:00.000Z');

function fakeSigner() {
  const sign = vi.fn(async (key: string, _options: SignObjectUrlOptions) => ({
    url: `https://files.test/${key}`,
    expiresAt: EXPIRES_AT,
  }));
  return { signer: { sign } as unknown as ObjectUrlSigner, sign };
}

/** 頭像：sm 32、md 96、lg 256（長邊），各附 2x；`sm@2x`（64）與 md 不同大，`md@2x`（192）也是自己的物件。 */
const AVATAR: ImageObjectSet = {
  keyPrefix: 'images/a1/r2',
  width: 800,
  height: 800,
  formats: ['jpeg', 'webp'],
  renditions: {
    sm: { width: 32, height: 32 },
    'sm@2x': { width: 64, height: 64 },
    md: { width: 96, height: 96 },
    'md@2x': { width: 192, height: 192 },
    lg: { width: 256, height: 256 },
    'lg@2x': { width: 512, height: 512, sameAs: 'master' },
    master: { width: 512, height: 512 },
  },
  ttlSeconds: 12 * 3600,
  cdn: 'imageAsset',
};

describe('ImageUrlService（docs/architecture/backend/25-image.md §3、§6）', () => {
  it('密度版本：src 是主格式的 1x，srcSet 是 1x ＋ 2x，其他格式放在 sources', async () => {
    const { signer } = fakeSigner();
    const result = await new ImageUrlService(signer).sources(
      AVATAR,
      densityLayouts(AVATAR, ['sm']),
    );

    expect(result).toEqual({
      width: 800,
      height: 800,
      expiresAt: EXPIRES_AT.toISOString(),
      variants: {
        sm: {
          src: 'https://files.test/images/a1/r2/sm.jpg',
          srcSet:
            'https://files.test/images/a1/r2/sm.jpg 1x, https://files.test/images/a1/r2/sm@2x.jpg 2x',
          sources: [
            {
              type: 'image/webp',
              srcSet:
                'https://files.test/images/a1/r2/sm.webp 1x, https://files.test/images/a1/r2/sm@2x.webp 2x',
            },
          ],
          width: 32,
          height: 32,
        },
      },
    });
    expect(ImageSourcesSchema.parse(result)).toEqual(result);
  });

  it('2x 與另一個尺寸共用物件時（sameAs）用那個物件的 key，而且同一個物件只簽一次', async () => {
    const { signer, sign } = fakeSigner();
    const result = await new ImageUrlService(signer).sources(AVATAR, {
      lg: { density: { '1x': 'lg', '2x': 'lg@2x' } },
      full: { density: { '1x': 'master' } },
    });

    expect(result.variants.lg?.srcSet).toBe(
      'https://files.test/images/a1/r2/lg.jpg 1x, https://files.test/images/a1/r2/master.jpg 2x',
    );
    const keys = sign.mock.calls.map(([key]) => key);
    expect(keys.filter((key) => key === 'images/a1/r2/master.jpg')).toHaveLength(1);
  });

  it('寬度版本：srcSet 帶 w 描述，src 是第一個尺寸', async () => {
    const { signer } = fakeSigner();
    const gallery: ImageObjectSet = {
      keyPrefix: 'gallery/g1/r1',
      width: 4000,
      height: 3000,
      formats: ['webp'],
      renditions: {
        thumb: { width: 480, height: 360 },
        medium: { width: 1280, height: 960 },
      },
      ttlSeconds: 3600,
    };
    const result = await new ImageUrlService(signer).sources(gallery, {
      responsive: { widths: ['thumb', 'medium'] },
    });

    expect(result.variants.responsive).toEqual({
      src: 'https://files.test/gallery/g1/r1/thumb.webp',
      srcSet:
        'https://files.test/gallery/g1/r1/thumb.webp 480w, https://files.test/gallery/g1/r1/medium.webp 1280w',
      sources: [],
      width: 480,
      height: 360,
    });
  });

  it('以用途的效期與 cdn 資源類型簽章', async () => {
    const { signer, sign } = fakeSigner();
    await new ImageUrlService(signer).sources(AVATAR, densityLayouts(AVATAR, ['md']));

    for (const [, options] of sign.mock.calls) {
      expect(options).toEqual({ expiresIn: 12 * 3600, cdn: 'imageAsset' });
    }
  });

  it('expiresAt 是最早到期的網址', async () => {
    const sign = vi.fn(async (key: string) => ({
      url: key,
      expiresAt: key.endsWith('.webp') ? new Date('2026-10-09T11:00:00.000Z') : EXPIRES_AT,
    }));
    const result = await new ImageUrlService({ sign } as unknown as ObjectUrlSigner).sources(
      AVATAR,
      densityLayouts(AVATAR, ['sm']),
    );
    expect(result.expiresAt).toBe('2026-10-09T11:00:00.000Z');
  });

  it.each([299, 86_401])('效期 %i 秒超出 5 分鐘到 24 小時的範圍：拋錯（程式錯誤）', async (ttl) => {
    const { signer } = fakeSigner();
    await expect(
      new ImageUrlService(signer).sources(
        { ...AVATAR, ttlSeconds: ttl },
        { sm: { density: { '1x': 'sm' } } },
      ),
    ).rejects.toThrow('超出範圍');
  });

  it('引用不存在的尺寸、沒有格式、沒有版本：拋錯', async () => {
    const service = new ImageUrlService(fakeSigner().signer);
    await expect(service.sources(AVATAR, { x: { density: { '1x': 'xl' } } })).rejects.toThrow(
      '沒有尺寸 xl',
    );
    await expect(
      service.sources({ ...AVATAR, formats: [] }, densityLayouts(AVATAR, ['sm'])),
    ).rejects.toThrow('沒有任何格式');
    await expect(service.sources(AVATAR, {})).rejects.toThrow('沒有要輸出的版本');
  });
});

describe('densityLayouts', () => {
  it('有 <名稱>@2x 的尺寸才帶 2x', () => {
    expect(
      densityLayouts(
        {
          renditions: {
            sm: { width: 1, height: 1 },
            'sm@2x': { width: 2, height: 2 },
            og: { width: 1, height: 1 },
          },
        },
        ['sm', 'og'],
      ),
    ).toEqual({
      sm: { density: { '1x': 'sm', '2x': 'sm@2x' } },
      og: { density: { '1x': 'og' } },
    });
  });
});
