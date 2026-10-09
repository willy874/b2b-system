import { describe, expect, it } from 'vitest';

import { takenAtOf, toGalleryExif, wallClockToUtc } from '../gallery-exif';

describe('takenAtOf（拍攝時間，docs/architecture/backend/26-gallery.md §5）', () => {
  it.each([
    ['有時區偏移：換算成 UTC', '2026:03:14 10:20:30', '+08:00', '2026-03-14T02:20:30.000Z'],
    ['負的偏移、沒有冒號', '2026:03:14 10:20:30', '-0530', '2026-03-14T15:50:30.000Z'],
    ['Z', '2026:03:14 10:20:30', 'Z', '2026-03-14T10:20:30.000Z'],
    [
      '沒有偏移：以租戶時區（Asia/Taipei）解讀',
      '2026:03:14 10:20:30',
      undefined,
      '2026-03-14T02:20:30.000Z',
    ],
    ['偏移格式不對：當作沒有', '2026:03:14 10:20:30', 'GMT+8', '2026-03-14T02:20:30.000Z'],
    ['以 - 分隔日期也接受', '2026-03-14 10:20:30', '+00:00', '2026-03-14T10:20:30.000Z'],
  ])('%s', (_name, dateTimeOriginal, offsetTimeOriginal, expected) => {
    expect(
      takenAtOf(
        { hasGps: false, dateTimeOriginal, offsetTimeOriginal },
        'Asia/Taipei',
      )?.toISOString(),
    ).toBe(expected);
  });

  it.each([
    ['沒有拍攝時間', undefined],
    ['相機沒設時間', '0000:00:00 00:00:00'],
    ['1900 年以前', '1800:01:01 00:00:00'],
    ['不存在的日期', '2026:02:30 10:00:00'],
    ['不是時間', 'yesterday'],
  ])('%s → null', (_name, dateTimeOriginal) => {
    expect(takenAtOf({ hasGps: false, dateTimeOriginal }, 'UTC')).toBeNull();
  });

  it('日光節約時間：紐約 7 月是 UTC−4、1 月是 UTC−5', () => {
    const clock = { year: 2026, month: 7, day: 1, hour: 12, minute: 0, second: 0 };
    expect(wallClockToUtc(clock, 'America/New_York').toISOString()).toBe(
      '2026-07-01T16:00:00.000Z',
    );
    expect(wallClockToUtc({ ...clock, month: 1 }, 'America/New_York').toISOString()).toBe(
      '2026-01-01T17:00:00.000Z',
    );
  });
});

describe('toGalleryExif（D5：不存 GPS）', () => {
  it('只留有值的欄位，數字四捨五入；GPS 與時間不進 exif 欄', () => {
    expect(
      toGalleryExif({
        hasGps: true,
        make: 'Acme',
        fNumber: 2.799999,
        exposureTime: 0.0040000001,
        focalLength: 35.04,
        iso: 0,
        dateTimeOriginal: '2026:03:14 10:20:30',
      }),
    ).toEqual({ make: 'Acme', fNumber: 2.8, exposureTime: 0.004, focalLength: 35 });
  });

  it('什麼都沒有時是 null', () => {
    expect(toGalleryExif({ hasGps: false })).toBeNull();
  });
});
