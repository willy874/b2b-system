import { describe, expect, it } from 'vitest';

import { IMAGE_SIGNATURE_TYPES, matchesImageSignature } from '../imageSignature';

const blob = (bytes: readonly number[]) => new Blob([new Uint8Array(bytes)]);
/** `????ftyp<brand>`：ISO BMFF 的前 12 個位元組。 */
const ftyp = (brand: string) => [
  0,
  0,
  0,
  0x1c,
  0x66,
  0x74,
  0x79,
  0x70,
  ...[...brand].map((c) => c.charCodeAt(0)),
];

describe('matchesImageSignature（圖片的檔頭簽章）', () => {
  it.each([
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]],
    ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
    ['image/gif', [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]],
    ['image/gif', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ['image/webp', [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]],
    ['image/avif', ftyp('avif')],
    ['image/avif', ftyp('avis')],
    ['image/tiff', [0x49, 0x49, 0x2a, 0x00]],
    ['image/tiff', [0x4d, 0x4d, 0x00, 0x2a]],
  ])('%s：檔頭相符 → true', async (type, bytes) => {
    await expect(matchesImageSignature(blob(bytes), type)).resolves.toBe(true);
  });

  it.each([
    ['image/png', [0xff, 0xd8, 0xff]],
    ['image/webp', [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20]],
    ['image/avif', ftyp('heic')],
    ['image/tiff', [0x49, 0x49, 0x00, 0x2a]],
  ])('%s：檔頭不符 → false', async (type, bytes) => {
    await expect(matchesImageSignature(blob(bytes), type)).resolves.toBe(false);
  });

  it('檔案比檔頭短（下載到一半）→ false', async () => {
    await expect(matchesImageSignature(blob([0x89, 0x50]), 'image/png')).resolves.toBe(false);
  });

  it('認不得的型別 → undefined（交給呼叫端決定）', async () => {
    await expect(matchesImageSignature(blob([1, 2, 3]), 'image/svg+xml')).resolves.toBeUndefined();
    await expect(matchesImageSignature(blob([1, 2, 3]), 'image/heic')).resolves.toBeUndefined();
  });

  it('IMAGE_SIGNATURE_TYPES 列出認得的六種型別', () => {
    expect(IMAGE_SIGNATURE_TYPES).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/avif',
      'image/tiff',
    ]);
  });
});
