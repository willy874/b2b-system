/** 一種檔頭：`undefined` 的位置不比對（例：RIFF 容器的長度欄位）。 */
type Signature = ReadonlyArray<number | undefined>;

/**
 * 常見點陣圖的檔頭（magic number）；副檔名改掉的其他檔案、下載到一半的圖片會對不上。
 * 只列出確定的格式：認不得的型別由 `matchesImageSignature` 回 `undefined`，交給呼叫端決定。
 */
const IMAGE_SIGNATURES = {
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
  // ????ftypavif／????ftypavis（ISO BMFF 的 major brand；序列是 avis）
  'image/avif': [
    [undefined, undefined, undefined, undefined, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66],
    [undefined, undefined, undefined, undefined, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x73],
  ],
  // II*\0（little-endian）／MM\0*（big-endian）
  'image/tiff': [
    [0x49, 0x49, 0x2a, 0x00],
    [0x4d, 0x4d, 0x00, 0x2a],
  ],
} as const satisfies Record<string, readonly Signature[]>;

/** 最長的檔頭有幾個位元組：只讀這麼多。 */
const HEAD_LENGTH = 12;

/** `matchesImageSignature` 認得的型別。 */
export type ImageSignatureType = keyof typeof IMAGE_SIGNATURES;

/** `matchesImageSignature` 認得的型別（PNG、JPEG、GIF、WebP、AVIF、TIFF）。 */
export const IMAGE_SIGNATURE_TYPES: readonly ImageSignatureType[] = Object.keys(
  IMAGE_SIGNATURES,
) as ImageSignatureType[];

function isKnownType(type: string): type is ImageSignatureType {
  return Object.hasOwn(IMAGE_SIGNATURES, type);
}

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
 * 檔案的檔頭是不是 `type` 這種圖片：相符回 `true`、不符回 `false`，認不得的型別回 `undefined`（不讀檔案）。
 * 用來擋下「改了副檔名的其他檔案」與「損壞的圖片」——它們上傳後只會是一張破圖。
 */
export async function matchesImageSignature(
  file: Blob,
  type: string,
): Promise<boolean | undefined> {
  if (!isKnownType(type)) return undefined;
  const signatures: readonly Signature[] = IMAGE_SIGNATURES[type];
  const head = await readHead(file, HEAD_LENGTH);
  return signatures.some((signature) =>
    signature.every((byte, index) => byte === undefined || head[index] === byte),
  );
}
