import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { parseExif } from '@/core/image/exif';

import { minimalPdf, renderPhoto, toDmsRational } from '../images';

describe('dev seed 的圖片產生器', () => {
  const spec = {
    width: 120,
    height: 80,
    format: 'jpeg' as const,
    seed: 3,
    label: 'TEST 01',
    exif: {
      dateTimeOriginal: '2026:03:14 10:20:30',
      offsetTimeOriginal: '+08:00',
      camera: {
        make: 'SONY',
        model: 'ILCE-7M4',
        lensModel: 'FE 50mm',
        focalLength: 50,
        fNumber: 2.8,
        exposureTime: 1 / 250,
        iso: 200,
      },
      location: { latitude: 25.033_964, longitude: 121.564_472 },
    },
  };

  it('同一份規格產生同一份位元組', async () => {
    expect((await renderPhoto(spec)).equals(await renderPhoto(spec))).toBe(true);
  });

  it('寫入的 EXIF 讀得回相機、拍攝時間與 GPS（api 會依設定移除 GPS）', async () => {
    const data = await renderPhoto(spec);
    const metadata = await sharp(data).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 120, height: 80 });
    expect(parseExif(metadata.exif)).toMatchObject({
      make: 'SONY',
      model: 'ILCE-7M4',
      lensModel: 'FE 50mm',
      dateTimeOriginal: '2026:03:14 10:20:30',
      offsetTimeOriginal: '+08:00',
      iso: 200,
      hasGps: true,
    });
  });

  it('沒有 EXIF 的規格產生的圖沒有 GPS', async () => {
    const data = await renderPhoto({ ...spec, format: 'png', exif: undefined });
    const metadata = await sharp(data).metadata();
    expect(metadata.format).toBe('png');
    expect(parseExif(metadata.exif).hasGps).toBe(false);
  });

  it.each([
    [25.5, '25/1 30/1 0/100'],
    [-33.86, '33/1 51/1 3600/100'],
  ])('toDmsRational(%s) → %s', (value, expected) => {
    expect(toDmsRational(value)).toBe(expected);
  });

  it('PDF 的 xref 位移指向每個物件的開頭', () => {
    const pdf = minimalPdf('Hello (dev)').toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(startxref).startsWith('xref')).toBe(true);
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets).toHaveLength(5);
    for (const [index, offset] of offsets.entries()) {
      expect(pdf.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    }
  });
});
