import { Readable } from 'node:stream';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { ImageDecodeError } from '../image-processor';
import { SharpImageProcessor } from '../sharp-image-processor';

const processor = new SharpImageProcessor();
const MAX_BYTES = 10 * 1024 * 1024;

function solid(width: number, height: number, alpha = false) {
  return sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 255, g: 0, b: 0, alpha: 0.5 } : '#ff0000',
    },
  });
}

describe('SharpImageProcessor', () => {
  it('輸出的 JPEG 是 progressive，並等比縮到長邊上限', async () => {
    const decoded = await processor.decode(await solid(4000, 2000).png().toBuffer(), {
      maxBytes: MAX_BYTES,
    });
    expect(decoded.info).toEqual({ width: 4000, height: 2000, hasAlpha: false });

    const output = await decoded.render({ format: 'jpeg', maxEdge: 1000 });
    expect(output).toMatchObject({ contentType: 'image/jpeg', width: 1000, height: 500 });
    const metadata = await sharp(output.data).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.isProgressive).toBe(true);
  });

  it('同一份解碼結果可以輸出多個版本；比上限小的不放大', async () => {
    const decoded = await processor.decode(await solid(300, 200).png().toBuffer(), {
      maxBytes: MAX_BYTES,
    });
    const [large, small] = await Promise.all([
      decoded.render({ format: 'webp', maxEdge: 2560 }),
      decoded.render({ format: 'avif', maxEdge: 100 }),
    ]);
    expect(large).toMatchObject({ contentType: 'image/webp', width: 300, height: 200 });
    expect(small).toMatchObject({ contentType: 'image/avif', width: 100, height: 67 });
  });

  it('透明圖回報 hasAlpha；轉成 JPEG 時鋪白底', async () => {
    const decoded = await processor.decode(await solid(10, 10, true).png().toBuffer(), {
      maxBytes: MAX_BYTES,
    });
    expect(decoded.info.hasAlpha).toBe(true);
    const jpeg = await decoded.render({ format: 'jpeg' });
    const { data } = await sharp(jpeg.data).raw().toBuffer({ resolveWithObject: true });
    // 50% 紅 ＋ 白底 ≈ (255, 128, 128)
    expect(data[0]).toBeGreaterThan(240);
    expect(data[1]).toBeGreaterThan(100);
    expect(data[1]).toBeLessThan(160);
  });

  it('依 EXIF 方向轉正：尺寸是使用者看到的方向', async () => {
    const rotated = await solid(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const decoded = await processor.decode(rotated, { maxBytes: MAX_BYTES });
    expect(decoded.info).toMatchObject({ width: 100, height: 200 });
    expect(await decoded.render({ format: 'png' })).toMatchObject({ width: 100, height: 200 });
  });

  it('可以從串流讀入', async () => {
    const buffer = await solid(20, 10).png().toBuffer();
    const decoded = await processor.decode(
      Readable.from([buffer.subarray(0, 5), buffer.subarray(5)]),
      {
        maxBytes: MAX_BYTES,
      },
    );
    expect(decoded.info).toMatchObject({ width: 20, height: 10 });
  });

  it('不是影像、超過位元組上限時拋 ImageDecodeError', async () => {
    await expect(
      processor.decode(Buffer.from('not an image'), { maxBytes: MAX_BYTES }),
    ).rejects.toBeInstanceOf(ImageDecodeError);
    const buffer = await solid(20, 10).png().toBuffer();
    await expect(
      processor.decode(Readable.from([buffer]), { maxBytes: 10 }),
    ).rejects.toBeInstanceOf(ImageDecodeError);
  });
});
