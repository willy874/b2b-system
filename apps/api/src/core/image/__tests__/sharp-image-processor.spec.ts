import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ImageDecodeError } from '../image-processor';
import { SharpImageProcessor } from '../sharp-image-processor';

const processor = new SharpImageProcessor();
const MAX_BYTES = 10 * 1024 * 1024;

/** 解碼時寫出的暫存檔（`b2b-image-<uuid>`）；暫存目錄每個測試各自一個，不受其他程序影響。 */
async function spooled(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((name) => name.startsWith('b2b-image-'));
}

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
  const originalTmpdir = process.env.TMPDIR;
  let scratch: string;
  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sharp-spec-'));
    // os.tmpdir() 每次呼叫都讀 TMPDIR
    process.env.TMPDIR = scratch;
  });
  afterEach(async () => {
    process.env.TMPDIR = originalTmpdir;
    await rm(scratch, { recursive: true, force: true });
  });

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

  it('串流輸入先寫到暫存檔再解碼（不整份讀進記憶體）；dispose 之後暫存檔被刪除', async () => {
    const decoded = await processor.decode(Readable.from([await solid(40, 20).png().toBuffer()]), {
      maxBytes: MAX_BYTES,
    });
    expect(await spooled()).toHaveLength(1);
    await expect(decoded.render({ format: 'webp', maxEdge: 10 })).resolves.toMatchObject({
      width: 10,
      height: 5,
    });
    await decoded.dispose();
    await decoded.dispose();
    expect(await spooled()).toEqual([]);
  });

  it('超過位元組上限或無法解碼時不留下暫存檔', async () => {
    await expect(
      processor.decode(Readable.from([await solid(20, 10).png().toBuffer()]), { maxBytes: 10 }),
    ).rejects.toBeInstanceOf(ImageDecodeError);
    await expect(
      processor.decode(Readable.from([Buffer.from('not an image')]), { maxBytes: MAX_BYTES }),
    ).rejects.toBeInstanceOf(ImageDecodeError);
    expect(await spooled()).toEqual([]);
  });

  it('限制 libvips 的執行緒數與操作快取：與 WebSocket 同一個程序，不能吃滿核心與記憶體', () => {
    expect(sharp.concurrency()).toBeLessThanOrEqual(2);
    expect(sharp.cache().memory.max).toBeLessThanOrEqual(16);
  });
});
