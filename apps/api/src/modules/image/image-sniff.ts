/** 判斷型別需要讀的位元組數。 */
export const SNIFF_BYTES = 64;

/**
 * 以檔頭判斷圖片的型別（docs/architecture/backend/25-image.md §15.5）：不信任瀏覽器宣告的 `Content-Type`，
 * 也在交給解碼器之前擋掉 SVG——sharp 會解析 SVG（XML），用途不收它就不該讓它進到解碼器。
 * 認不出來回 undefined。
 */
export function sniffImageType(head: Uint8Array): string | undefined {
  const startsWith = (bytes: readonly number[], offset = 0) =>
    bytes.every((byte, index) => head[offset + index] === byte);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...head.subarray(offset, offset + length));

  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  // ISO BMFF：`????ftyp<brand>`
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1') return 'image/heic';
  }
  if (startsWith([0x49, 0x49, 0x2a, 0x00]) || startsWith([0x4d, 0x4d, 0x00, 0x2a])) {
    return 'image/tiff';
  }
  // 文字開頭的 `<`（可能先有 BOM 或空白）：當作 SVG／XML
  const bom = startsWith([0xef, 0xbb, 0xbf]) ? 3 : 0;
  const text = ascii(bom, Math.min(head.length, SNIFF_BYTES) - bom).trimStart();
  if (text.startsWith('<')) return 'image/svg+xml';
  return undefined;
}
