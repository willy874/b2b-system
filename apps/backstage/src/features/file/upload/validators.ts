import type { FileValidator } from '@/core/file';
import { formatBytes } from '@/shared/utils';

/** 超過後端的單檔上限：送出前就擋下，不必登記後才收到 413。 */
export const maxSizeValidator: FileValidator = {
  id: 'max-size',
  validate: (file, { maxSize }) =>
    maxSize !== undefined && file.size > maxSize
      ? {
          validatorId: 'max-size',
          messageKey: 'file.validation.tooLarge',
          params: { max: formatBytes(maxSize) },
        }
      : undefined,
};

/** 常見點陣圖的檔頭（magic number）；副檔名改掉的其他檔案、下載到一半的圖片會對不上。 */
const IMAGE_SIGNATURES: Record<string, Array<Array<number | undefined>>> = {
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/gif': [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  ],
  // RIFF????WEBP
  'image/webp': [
    [0x52, 0x49, 0x46, 0x46, undefined, undefined, undefined, undefined, 0x57, 0x45, 0x42, 0x50],
  ],
};

/** 讀 Blob 的前幾個位元組（jsdom 的 Blob 沒有 `arrayBuffer`，退回 FileReader）。 */
function readHead(file: Blob, length: number): Promise<Uint8Array> {
  const slice = file.slice(0, length);
  if (typeof slice.arrayBuffer === 'function') {
    return slice.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(new Uint8Array(reader.result as ArrayBuffer)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * 特殊檔案驗證的範例：宣告為圖片的檔案，檔頭必須是那種圖片。
 * 擋下「改了副檔名的其他檔案」與「損壞的圖片」——它們上傳後在列表裡只會是一張破圖。
 */
export const imageSignatureValidator: FileValidator = {
  id: 'image-signature',
  async validate(file) {
    const signatures = IMAGE_SIGNATURES[file.type];
    if (!signatures) return undefined;
    const head = await readHead(file, 12);
    const matches = signatures.some((signature) =>
      signature.every((byte, index) => byte === undefined || head[index] === byte),
    );
    return matches
      ? undefined
      : {
          validatorId: 'image-signature',
          messageKey: 'file.validation.imageCorrupted',
          params: { type: file.type },
        };
  },
};
