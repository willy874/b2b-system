import { formatBytes } from '@b2b-system/web-shared/utils';

import type { FileValidator } from '@/core/file';
import { matchesImageSignature } from '@/core/upload';

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

/**
 * 檢查檔頭的型別。`core/upload` 的 `matchesImageSignature` 另外認得 AVIF、TIFF，但檔案管理器原本不檢查它們（放行），
 * 這裡維持原本的四種：不讓重構改變哪些檔案上傳得了。
 */
const CHECKED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/**
 * 特殊檔案驗證的範例：宣告為圖片的檔案，檔頭必須是那種圖片。
 * 擋下「改了副檔名的其他檔案」與「損壞的圖片」——它們上傳後在列表裡只會是一張破圖。
 */
export const imageSignatureValidator: FileValidator = {
  id: 'image-signature',
  async validate(file) {
    if (!CHECKED_IMAGE_TYPES.has(file.type)) return undefined;
    const matches = await matchesImageSignature(file, file.type);
    return matches !== false
      ? undefined
      : {
          validatorId: 'image-signature',
          messageKey: 'file.validation.imageCorrupted',
          params: { type: file.type },
        };
  },
};
