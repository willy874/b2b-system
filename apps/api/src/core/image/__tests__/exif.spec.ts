import sharp from 'sharp';
import type { Sharp } from 'sharp';
import { describe, expect, it } from 'vitest';

import { parseExif, stripGpsFromOriginal, tiffStartOf, wipeGpsInPlace } from '../exif';

const EXIF = {
  IFD0: { Make: 'Acme', Model: 'X1' },
  IFD2: {
    DateTimeOriginal: '2026:03:14 10:20:30',
    OffsetTimeOriginal: '+08:00',
    FNumber: '28/10',
    ExposureTime: '1/250',
    ISOSpeedRatings: '200',
    FocalLength: '35/1',
    Flash: '1',
    LensModel: 'Prime 35',
  },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '25/1 2/1 0/1', GPSLongitudeRef: 'E' },
};

function base(width = 40, height = 20) {
  return sharp({ create: { width, height, channels: 3, background: '#336699' } });
}

async function exifOf(buffer: Buffer): Promise<Buffer | undefined> {
  return (await sharp(buffer).metadata()).exif;
}

describe('parseExif（docs/architecture/backend/26-gallery.md §5）', () => {
  it('讀出相機、鏡頭、曝光參數、拍攝時間與時區偏移，並偵測到 GPS', async () => {
    const jpeg = await base().jpeg().withExif(EXIF).toBuffer();
    const fields = parseExif(await exifOf(jpeg));
    expect(fields).toMatchObject({
      make: 'Acme',
      model: 'X1',
      lensModel: 'Prime 35',
      dateTimeOriginal: '2026:03:14 10:20:30',
      offsetTimeOriginal: '+08:00',
      fNumber: 2.8,
      exposureTime: 0.004,
      iso: 200,
      focalLength: 35,
      flashFired: true,
      hasGps: true,
    });
  });

  it('沒有 EXIF、或不是 TIFF 結構時只回 hasGps: false', () => {
    expect(parseExif(undefined)).toEqual({ hasGps: false });
    expect(parseExif(Buffer.from('Exif\0\0garbage-data', 'latin1'))).toEqual({ hasGps: false });
  });

  it('位移超出範圍的欄位略過，不拋例外', async () => {
    const exif = await exifOf(await base().jpeg().withExif(EXIF).toBuffer());
    if (!exif) throw new Error('沒有 EXIF');
    const truncated = exif.subarray(0, 40);
    expect(() => parseExif(truncated)).not.toThrow();
  });
});

describe('stripGpsFromOriginal（D5：不重新編碼像素）', () => {
  it.each([
    ['image/jpeg', (image: Sharp) => image.jpeg()],
    ['image/png', (image: Sharp) => image.png()],
    ['image/webp', (image: Sharp) => image.webp()],
    ['image/avif', (image: Sharp) => image.avif()],
  ] as const)('%s：清掉 GPS、保留其他欄位，大小不變、仍能解碼', async (type, encode) => {
    const original = await encode(base().withExif(EXIF)).toBuffer();
    const result = stripGpsFromOriginal(original, type, await exifOf(original));
    expect(result).toMatchObject({ stripped: true, located: true });
    expect(result.data.length).toBe(original.length);

    const after = parseExif(await exifOf(result.data));
    expect(after.hasGps).toBe(false);
    expect(after.make).toBe('Acme');
    const decoded = await sharp(result.data).raw().toBuffer();
    expect(decoded.equals(await sharp(original).raw().toBuffer())).toBe(true);
    // 傳入的 Buffer 不被修改
    expect(parseExif(await exifOf(original)).hasGps).toBe(true);
  });

  it('沒有 GPS 時 stripped 是 false', async () => {
    const original = await base()
      .jpeg()
      .withExif({ IFD0: { Make: 'Acme' } })
      .toBuffer();
    expect(stripGpsFromOriginal(original, 'image/jpeg', await exifOf(original))).toMatchObject({
      stripped: false,
      located: true,
    });
  });

  it('在檔案裡找不到 EXIF 的位置：located 是 false（呼叫端改用整段移除）', async () => {
    const original = await base().jpeg().toBuffer();
    const exif = await exifOf(await base().jpeg().withExif(EXIF).toBuffer());
    expect(stripGpsFromOriginal(original, 'image/jpeg', exif)).toMatchObject({
      stripped: false,
      located: false,
    });
  });

  it('wipeGpsInPlace：TIFF 結構的 GPS IFD 歸零', async () => {
    const exif = await exifOf(await base().jpeg().withExif(EXIF).toBuffer());
    if (!exif) throw new Error('沒有 EXIF');
    const copy = Buffer.from(exif);
    expect(wipeGpsInPlace(copy, tiffStartOf(copy))).toBe(true);
    expect(parseExif(copy).hasGps).toBe(false);
    // 第二次沒有東西可清
    expect(wipeGpsInPlace(copy, tiffStartOf(copy))).toBe(false);
  });
});
