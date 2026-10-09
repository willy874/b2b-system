import type { ImageUsage } from './types';

/** 判斷型別需要讀的位元組數。 */
const SNIFF_BYTES = 64;

/**
 * 以檔頭判斷圖片的型別（與 api 的 `image-sniff.ts` 相同的規則）：不信任 `File.type`——貼上與拖曳的檔案、
 * 改了副檔名的檔案都可能宣告錯。認不出來回 undefined。
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
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1') return 'image/heic';
  }
  if (startsWith([0x49, 0x49, 0x2a, 0x00]) || startsWith([0x4d, 0x4d, 0x00, 0x2a])) {
    return 'image/tiff';
  }
  const bom = startsWith([0xef, 0xbb, 0xbf]) ? 3 : 0;
  if (
    ascii(bom, Math.min(head.length, SNIFF_BYTES) - bom)
      .trimStart()
      .startsWith('<')
  ) {
    return 'image/svg+xml';
  }
  return undefined;
}

/** 讀 Blob 的前幾個位元組（jsdom 的 Blob 沒有 `arrayBuffer` 時退回 FileReader）。 */
async function readHead(file: Blob): Promise<Uint8Array> {
  const slice = file.slice(0, SNIFF_BYTES);
  if (typeof slice.arrayBuffer === 'function') return new Uint8Array(await slice.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(new Uint8Array(reader.result as ArrayBuffer)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsArrayBuffer(slice);
  });
}

/** 不能用的原因：`messageKey` 是完整字面量的語系 key（docs/coding-standards/06-literal-strings.md）。 */
export interface ImageValidationIssue {
  reason: 'type' | 'size' | 'small';
  messageKey: string;
  params?: Record<string, unknown>;
}

/** 檢查通過時帶回以檔頭判斷的型別與尺寸（瀏覽器解不了的格式，例如 AVIF 在舊瀏覽器，尺寸是 undefined）。 */
export interface ImageValidationResult {
  issue?: ImageValidationIssue;
  contentType?: string;
  size?: { width: number; height: number };
}

/** 裁切之後最大的範圍：有比例時是中央照比例的那一塊。 */
export function largestCrop(
  size: { width: number; height: number },
  aspectRatio: number | null,
): { width: number; height: number } {
  if (aspectRatio === null) return size;
  const width = Math.min(size.width, size.height * aspectRatio);
  return { width, height: width / aspectRatio };
}

/** 尺寸夠不夠用途的下限（以裁切之後最大的範圍判斷）。 */
export function isLargeEnough(size: { width: number; height: number }, usage: ImageUsage): boolean {
  const largest = largestCrop(size, usage.aspectRatio);
  return largest.width >= usage.minWidth && largest.height >= usage.minHeight;
}

async function readSize(file: Blob): Promise<{ width: number; height: number } | undefined> {
  if (typeof createImageBitmap !== 'function') return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    // 瀏覽器解不了（例：舊瀏覽器的 AVIF）：交給後端判斷尺寸
    return undefined;
  }
}

/**
 * 上傳前的檢查（docs/architecture/frontend/23-image-picker.md §4）：檔頭判斷的型別、大小、最小尺寸。
 * 只是體驗：後端照樣再檢查一次。
 */
export async function validateImageFile(
  file: Blob,
  usage: ImageUsage,
): Promise<ImageValidationResult> {
  const contentType = sniffImageType(await readHead(file));
  if (!contentType || !usage.contentTypes.includes(contentType)) {
    return { issue: { reason: 'type', messageKey: 'imagePicker.validation.type' } };
  }
  if (file.size > usage.maxSize) {
    return {
      contentType,
      issue: {
        reason: 'size',
        messageKey: 'imagePicker.validation.size',
        params: { max: Math.floor(usage.maxSize / 1024 / 1024) },
      },
    };
  }
  const size = await readSize(file);
  if (size && !isLargeEnough(size, usage)) {
    return {
      contentType,
      size,
      issue: {
        reason: 'small',
        messageKey: 'imagePicker.validation.small',
        params: { width: usage.minWidth, height: usage.minHeight },
      },
    };
  }
  return { contentType, size };
}

/** 從剪貼簿或拖曳的項目取第一張圖片；`count` 是其中有幾個檔案（多於一個時提示只用第一張）。 */
export function firstImageFile(files: readonly File[]): { file: File | undefined; count: number } {
  const file = files.find((item) => item.type.startsWith('image/') || item.type === '');
  return { file, count: files.length };
}
