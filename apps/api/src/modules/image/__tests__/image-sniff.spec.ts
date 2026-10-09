import { describe, expect, it } from 'vitest';

import { sniffImageType } from '../image-sniff';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'));

describe('sniffImageType（以檔頭判斷，不信任宣告的型別）', () => {
  it.each([
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg'],
    ['PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'],
    ['GIF', ascii('GIF89a......'), 'image/gif'],
    ['WebP', ascii('RIFF\0\0\0\0WEBPVP8 '), 'image/webp'],
    ['AVIF', ascii('\0\0\0\x1cftypavif'), 'image/avif'],
    ['HEIC', ascii('\0\0\0\x18ftypheic'), 'image/heic'],
    ['TIFF', bytes(0x49, 0x49, 0x2a, 0x00), 'image/tiff'],
    ['SVG', ascii('<svg xmlns="http://www.w3.org/2000/svg">'), 'image/svg+xml'],
    [
      '帶 BOM 與空白的 XML',
      Uint8Array.from([0xef, 0xbb, 0xbf, ...ascii('  <?xml version')]),
      'image/svg+xml',
    ],
  ])('%s', (_name, head, expected) => {
    expect(sniffImageType(head)).toBe(expected);
  });

  it('認不出來（例：純文字、空的）回 undefined', () => {
    expect(sniffImageType(ascii('hello world'))).toBeUndefined();
    expect(sniffImageType(new Uint8Array())).toBeUndefined();
  });
});
