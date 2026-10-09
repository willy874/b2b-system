import { describe, expect, it } from 'vitest';

import type { GalleryItem } from '@/shared/api-sdk';

import { pairedItemId, parsePairedItemId } from '../batch';
import { decodeBlurHash } from '../blurhash';
import { checkGalleryFile } from '../fileAction/register';
import { checkGalleryUpload } from '../hooks/useGalleryUpload';
import { parseGalleryViewPreference } from '../pages/Gallery/preference';
import {
  dayRangeToIso,
  groupGalleryItems,
  sectionKeyOf,
  startAtForMonth,
} from '../pages/Gallery/sections';
import { filtersOf } from '../pages/Gallery/useGalleryBrowse';

const item = (id: string, sortAt: string) =>
  ({ id, sortAt, createdAt: sortAt, width: 4, height: 3 }) as unknown as GalleryItem;

describe('groupGalleryItems（依日期分組，docs/architecture/frontend/24-gallery.md §3）', () => {
  const items = [
    item('a', new Date(2026, 2, 14, 10).toISOString()),
    item('b', new Date(2026, 2, 14, 8).toISOString()),
    item('c', new Date(2026, 2, 1, 8).toISOString()),
    item('d', new Date(2026, 1, 20, 8).toISOString()),
  ];

  it('依日：相鄰的同一天合併成一段，key 是當地日期', () => {
    const sections = groupGalleryItems(items, 'day', 'sortAt');
    expect(
      sections.map((section) => [section.key, section.items.map((entry) => entry.id)]),
    ).toEqual([
      ['2026-03-14', ['a', 'b']],
      ['2026-03-01', ['c']],
      ['2026-02-20', ['d']],
    ]);
  });

  it('依月', () => {
    expect(groupGalleryItems(items, 'month', 'sortAt').map((section) => section.key)).toEqual([
      '2026-03',
      '2026-02',
    ]);
  });

  it('不分組或依標題排序：只有一段；沒有圖片時沒有區段', () => {
    expect(groupGalleryItems(items, 'none', 'sortAt')).toHaveLength(1);
    expect(groupGalleryItems(items, 'day', null)).toHaveLength(1);
    expect(groupGalleryItems([], 'day', 'sortAt')).toEqual([]);
  });

  it('sectionKeyOf', () => {
    expect(sectionKeyOf(new Date(2026, 0, 5), 'day')).toBe('2026-01-05');
    expect(sectionKeyOf(new Date(2026, 0, 5), 'month')).toBe('2026-01');
  });
});

describe('日期捲軸與日期範圍', () => {
  it('新到舊時從下個月的第一天開始（取 < startAt），舊到新時從這個月的第一天', () => {
    expect(startAtForMonth('2026-03', 'desc')).toBe(new Date(2026, 3, 1).toISOString());
    expect(startAtForMonth('2026-12', 'desc')).toBe(new Date(2027, 0, 1).toISOString());
    expect(startAtForMonth('2026-03', 'asc')).toBe(new Date(2026, 2, 1).toISOString());
  });

  it('dayRangeToIso：`to` 包含那一天（換成隔天、不含）', () => {
    expect(dayRangeToIso('2026-03-01', '2026-03-31')).toEqual({
      takenFrom: new Date(2026, 2, 1).toISOString(),
      takenTo: new Date(2026, 3, 1).toISOString(),
    });
    expect(dayRangeToIso(undefined, undefined)).toEqual({
      takenFrom: undefined,
      takenTo: undefined,
    });
  });

  it('filtersOf：預設圖片日期新到舊、標題 A→Z，reverse 反轉', () => {
    expect(filtersOf({}, undefined).sort).toEqual([{ sort: 'sortAt', order: 'desc' }]);
    expect(filtersOf({ sort: 'title' }, undefined).sort).toEqual([{ sort: 'title', order: 'asc' }]);
    expect(filtersOf({ sort: 'title', reverse: true }, 'album').sort).toEqual([
      { sort: 'title', order: 'desc' },
    ]);
    expect(filtersOf({}, 'album-1').albumId).toBe('album-1');
  });
});

describe('偏好與批次項目 id', () => {
  it('parseGalleryViewPreference：不合法的欄位退回預設值', () => {
    expect(parseGalleryViewPreference({ layout: 'square', rowHeight: 999, grouping: 'x' })).toEqual(
      {
        layout: 'square',
        rowHeight: 180,
        grouping: 'day',
      },
    );
    expect(parseGalleryViewPreference({ layout: 'list' }).layout).toBe('list');
    expect(parseGalleryViewPreference({ layout: 'table' }).layout).toBe('justified');
    expect(parseGalleryViewPreference('garbage')).toEqual({
      layout: 'justified',
      rowHeight: 180,
      grouping: 'day',
    });
  });

  it('pairedItemId：第二個值編進 id，接手的分頁也知道', () => {
    expect(parsePairedItemId(pairedItemId('src', 'album'))).toEqual({
      first: 'src',
      second: 'album',
    });
    expect(parsePairedItemId(pairedItemId('src', undefined))).toEqual({ first: 'src' });
  });
});

describe('decodeBlurHash', () => {
  it('解出指定大小的 RGBA；不合法的字串回 undefined', () => {
    const pixels = decodeBlurHash('LEHV6nWB2yk8pyo0adR*.7kCMdnj', 4, 3);
    expect(pixels).toHaveLength(4 * 3 * 4);
    expect(pixels?.[3]).toBe(255);
    expect(decodeBlurHash('short', 4, 3)).toBeUndefined();
    expect(decodeBlurHash('LEHV6nWB2yk8', 4, 3)).toBeUndefined();
  });
});

describe('選檔的檢查（D6：HEIC 擋下並提示）', () => {
  const file = (name: string, type: string, bytes: number[] = []) =>
    new File([new Uint8Array(bytes)], name, { type });

  it.each([
    ['HEIC 的型別', file('a.heic', 'image/heic'), 'gallery.upload.heic'],
    ['HEIC 的副檔名（瀏覽器沒給型別）', file('IMG_1.HEIC', ''), 'gallery.upload.heic'],
    ['SVG', file('a.svg', 'image/svg+xml'), 'gallery.upload.notImage'],
    [
      '宣告成 PNG 但不是',
      file('a.png', 'image/png', [1, 2, 3, 4, 5, 6, 7, 8]),
      'gallery.upload.corrupted',
    ],
  ])('%s', async (_name, input, reasonKey) => {
    expect((await checkGalleryUpload(input))?.reasonKey).toBe(reasonKey);
  });

  it('真的 PNG 通過', async () => {
    const png = file('a.png', 'image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await checkGalleryUpload(png)).toBeUndefined();
  });

  it('檔案管理器的「加入圖片庫」：PDF、SVG、HEIC、太大的略過並說明原因', () => {
    const target = (name: string, contentType: string, size = 100) => ({
      id: name,
      name,
      contentType,
      size,
    });
    expect(checkGalleryFile(target('a.png', 'image/png'))).toEqual({ ok: true });
    expect(checkGalleryFile(target('a.pdf', 'application/pdf'))).toMatchObject({
      ok: false,
      reasonKey: 'gallery.fileAction.notImage',
    });
    expect(checkGalleryFile(target('a.svg', 'image/svg+xml'))).toMatchObject({ ok: false });
    expect(checkGalleryFile(target('a.heic', 'image/heic'))).toMatchObject({
      reasonKey: 'gallery.fileAction.heic',
    });
    expect(checkGalleryFile(target('big.jpg', 'image/jpeg', 51 * 1024 * 1024))).toMatchObject({
      reasonKey: 'gallery.fileAction.tooLarge',
    });
  });
});
