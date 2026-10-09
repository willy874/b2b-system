/**
 * EXIF（TIFF 結構）的最小解析與 GPS 移除（docs/architecture/backend/26-gallery.md §5）。
 *
 * 只讀圖片庫需要的欄位（相機、鏡頭、曝光參數、拍攝時間），不引入完整的 EXIF 套件；
 * 結構損毀、位移超出範圍時略過那個欄位，不拋例外（EXIF 是附帶的資訊，解析失敗不該讓整張圖失敗）。
 */

/** 解析出的欄位；沒有或讀不出來的是 undefined。時間是 EXIF 原本的字串，換算交給呼叫端（要知道租戶的時區）。 */
export interface ExifFields {
  make?: string;
  model?: string;
  lensMake?: string;
  lensModel?: string;
  /** `YYYY:MM:DD HH:MM:SS`（拍攝當地的時間）。 */
  dateTimeOriginal?: string;
  /** `+08:00`：`dateTimeOriginal` 的時區偏移（EXIF 2.31 起才有）。 */
  offsetTimeOriginal?: string;
  /** 秒。 */
  exposureTime?: number;
  fNumber?: number;
  iso?: number;
  /** mm。 */
  focalLength?: number;
  focalLength35mm?: number;
  /** 閃光燈有沒有閃（Flash 標籤的第 0 位元）。 */
  flashFired?: boolean;
  /** GPS IFD 裡有沒有任何欄位（位置資訊）。 */
  hasGps: boolean;
}

const TAG = {
  MAKE: 0x010f,
  MODEL: 0x0110,
  EXIF_IFD: 0x8769,
  GPS_IFD: 0x8825,
  EXPOSURE_TIME: 0x829a,
  F_NUMBER: 0x829d,
  ISO: 0x8827,
  DATE_TIME_ORIGINAL: 0x9003,
  OFFSET_TIME_ORIGINAL: 0x9011,
  FLASH: 0x9209,
  FOCAL_LENGTH: 0x920a,
  FOCAL_LENGTH_35MM: 0xa405,
  LENS_MAKE: 0xa433,
  LENS_MODEL: 0xa434,
} as const;

/** TIFF 的欄位型別 → 每個值的位元組數。 */
const TYPE_SIZE: Readonly<Record<number, number>> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};

/** 一個 IFD 最多讀幾個欄位：擋掉損毀的計數讓迴圈跑上萬次。 */
const MAX_ENTRIES = 512;
/** 字串欄位的長度上限。 */
const MAX_STRING = 256;

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** 欄位在 TIFF 內的位移（12 位元組的那一筆）。 */
  entryOffset: number;
  /** 值的位置：放得進 4 位元組時就在欄位內，否則是另外的位移。 */
  valueOffset: number;
  byteLength: number;
}

class TiffReader {
  readonly little: boolean;

  constructor(
    readonly data: Buffer,
    readonly start: number,
  ) {
    const order = data.toString('latin1', start, start + 2);
    if (order !== 'II' && order !== 'MM') throw new RangeError('不是 TIFF 結構');
    this.little = order === 'II';
    if (this.u16(2) !== 42) throw new RangeError('不是 TIFF 結構');
  }

  /** 以 TIFF 開頭為 0 的位移讀值；超出範圍拋 RangeError。 */
  u16(offset: number): number {
    const at = this.start + offset;
    return this.little ? this.data.readUInt16LE(at) : this.data.readUInt16BE(at);
  }

  u32(offset: number): number {
    const at = this.start + offset;
    return this.little ? this.data.readUInt32LE(at) : this.data.readUInt32BE(at);
  }

  get length(): number {
    return this.data.length - this.start;
  }

  firstIfd(): number {
    return this.u32(4);
  }

  entries(ifdOffset: number): Entry[] {
    if (ifdOffset <= 0 || ifdOffset + 2 > this.length) return [];
    const count = Math.min(this.u16(ifdOffset), MAX_ENTRIES);
    const result: Entry[] = [];
    for (let index = 0; index < count; index += 1) {
      const entryOffset = ifdOffset + 2 + index * 12;
      if (entryOffset + 12 > this.length) break;
      const type = this.u16(entryOffset + 2);
      const valueCount = this.u32(entryOffset + 4);
      const size = TYPE_SIZE[type] ?? 0;
      const byteLength = size * valueCount;
      const valueOffset = byteLength <= 4 ? entryOffset + 8 : this.u32(entryOffset + 8);
      result.push({
        tag: this.u16(entryOffset),
        type,
        count: valueCount,
        entryOffset,
        valueOffset,
        byteLength,
      });
    }
    return result;
  }

  inside(entry: Entry): boolean {
    return entry.byteLength > 0 && entry.valueOffset + entry.byteLength <= this.length;
  }

  string(entry: Entry): string | undefined {
    if (entry.type !== 2 || !this.inside(entry)) return undefined;
    const at = this.start + entry.valueOffset;
    const raw = this.data.toString('latin1', at, at + Math.min(entry.count, MAX_STRING));
    // 字串以 NUL 結尾；有些相機會補空白
    const value = raw.replace(/\0.*$/s, '').trim();
    return value.length > 0 ? toUtf8(value) : undefined;
  }

  number(entry: Entry): number | undefined {
    if (!this.inside(entry)) return undefined;
    switch (entry.type) {
      case 3:
        return this.u16(entry.valueOffset);
      case 4:
        return this.u32(entry.valueOffset);
      case 5: {
        const denominator = this.u32(entry.valueOffset + 4);
        return denominator === 0 ? undefined : this.u32(entry.valueOffset) / denominator;
      }
      case 10: {
        const at = this.start + entry.valueOffset;
        const numerator = this.little ? this.data.readInt32LE(at) : this.data.readInt32BE(at);
        const denominator = this.little
          ? this.data.readInt32LE(at + 4)
          : this.data.readInt32BE(at + 4);
        return denominator === 0 ? undefined : numerator / denominator;
      }
      default:
        return undefined;
    }
  }
}

/** EXIF 的 ASCII 欄位實際上常是 UTF-8（鏡頭名稱的 µ 等）：位元組能以 UTF-8 解讀就用它。 */
function toUtf8(latin1: string): string {
  const decoded = Buffer.from(latin1, 'latin1').toString('utf8');
  return decoded.includes('�') ? latin1 : decoded;
}

/** `metadata().exif` 開頭的 `Exif\0\0`（JPEG APP1 的識別字）；沒有時整段就是 TIFF。 */
const EXIF_PREFIX = Buffer.from('Exif\0\0', 'latin1');

/** EXIF 區塊裡 TIFF 結構開始的位移。 */
export function tiffStartOf(exif: Buffer): number {
  return exif.subarray(0, EXIF_PREFIX.length).equals(EXIF_PREFIX) ? EXIF_PREFIX.length : 0;
}

/** 解析 EXIF 區塊（sharp 的 `metadata().exif`）；不是 TIFF 結構時回 `{ hasGps: false }`。 */
export function parseExif(exif: Buffer | undefined): ExifFields {
  if (!exif || exif.length < 8) return { hasGps: false };
  let reader: TiffReader;
  try {
    reader = new TiffReader(exif, tiffStartOf(exif));
  } catch {
    // 不是 TIFF 結構（例：相機寫了別的東西）：當作沒有 EXIF
    return { hasGps: false };
  }
  const fields: ExifFields = { hasGps: false };
  try {
    const ifd0 = reader.entries(reader.firstIfd());
    let exifIfd: number | undefined;
    let gpsIfd: number | undefined;
    for (const entry of ifd0) {
      if (entry.tag === TAG.MAKE) fields.make = reader.string(entry);
      else if (entry.tag === TAG.MODEL) fields.model = reader.string(entry);
      else if (entry.tag === TAG.EXIF_IFD) exifIfd = reader.number(entry);
      else if (entry.tag === TAG.GPS_IFD) gpsIfd = reader.number(entry);
    }
    if (exifIfd) readExifIfd(reader, exifIfd, fields);
    if (gpsIfd) fields.hasGps = reader.entries(gpsIfd).length > 0;
  } catch (error) {
    // 位移超出範圍：保留已經讀到的欄位
    if (!(error instanceof RangeError)) throw error;
  }
  return fields;
}

function readExifIfd(reader: TiffReader, offset: number, fields: ExifFields): void {
  for (const entry of reader.entries(offset)) {
    switch (entry.tag) {
      case TAG.DATE_TIME_ORIGINAL:
        fields.dateTimeOriginal = reader.string(entry);
        break;
      case TAG.OFFSET_TIME_ORIGINAL:
        fields.offsetTimeOriginal = reader.string(entry);
        break;
      case TAG.EXPOSURE_TIME:
        fields.exposureTime = reader.number(entry);
        break;
      case TAG.F_NUMBER:
        fields.fNumber = reader.number(entry);
        break;
      case TAG.ISO:
        fields.iso = reader.number(entry);
        break;
      case TAG.FOCAL_LENGTH:
        fields.focalLength = reader.number(entry);
        break;
      case TAG.FOCAL_LENGTH_35MM:
        fields.focalLength35mm = reader.number(entry);
        break;
      case TAG.FLASH: {
        const flash = reader.number(entry);
        if (flash !== undefined) fields.flashFired = (flash & 1) === 1;
        break;
      }
      case TAG.LENS_MAKE:
        fields.lensMake = reader.string(entry);
        break;
      case TAG.LENS_MODEL:
        fields.lensModel = reader.string(entry);
        break;
      default:
        break;
    }
  }
}

/**
 * 就地清掉 TIFF 結構裡的 GPS（`data` 從 `start` 開始是 TIFF）：GPS IFD 的每個欄位與它指向的值都填 0、欄位數改成 0，
 * IFD0 指向它的那一筆保留（指向一個空的 IFD）。長度不變，不必改寫外層容器的大小，像素也完全沒動。
 * 有清到東西回 true。
 */
export function wipeGpsInPlace(data: Buffer, start: number): boolean {
  let reader: TiffReader;
  try {
    reader = new TiffReader(data, start);
  } catch {
    return false;
  }
  try {
    const gps = reader.entries(reader.firstIfd()).find((entry) => entry.tag === TAG.GPS_IFD);
    const gpsOffset = gps ? reader.number(gps) : undefined;
    if (!gpsOffset) return false;
    const entries = reader.entries(gpsOffset);
    if (entries.length === 0) return false;
    for (const entry of entries) {
      if (entry.byteLength > 4 && reader.inside(entry)) {
        data.fill(0, start + entry.valueOffset, start + entry.valueOffset + entry.byteLength);
      }
      data.fill(0, start + entry.entryOffset, start + entry.entryOffset + 12);
    }
    // 欄位數歸零：讀的人看到的是一個空的 GPS IFD
    data.fill(0, start + gpsOffset, start + gpsOffset + 2);
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 在原檔裡就地移除 GPS（不重新編碼像素；docs/architecture/backend/26-gallery.md D5）：
 * - JPEG（APP1）、WebP（`EXIF` 區塊）、AVIF（Exif item）、PNG（`eXIf` 區塊）：在檔案裡找到 sharp 讀出的那段 EXIF，就地清掉；
 *   PNG 另外重算那個區塊的 CRC；
 * - TIFF：整個檔案就是 TIFF 結構。
 *
 * 回傳 `stripped`（有清到 GPS）與 `located`（找得到 EXIF 在檔案裡的位置；找不到時呼叫端改用整段移除的退路）。
 * 不修改傳入的 Buffer。
 */
export function stripGpsFromOriginal(
  original: Buffer,
  contentType: string,
  exif: Buffer | undefined,
): { data: Buffer; stripped: boolean; located: boolean } {
  const data = Buffer.from(original);
  if (contentType === 'image/tiff') {
    return { data, stripped: wipeGpsInPlace(data, 0), located: true };
  }
  if (!exif || exif.length === 0) return { data, stripped: false, located: true };
  const at = data.indexOf(exif);
  if (at < 0) return { data, stripped: false, located: false };
  const stripped = wipeGpsInPlace(data, at + tiffStartOf(exif));
  if (stripped && data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    fixPngChunkCrc(data, at);
  }
  return { data, stripped, located: true };
}

/** 重算包含 `position` 的 PNG 區塊的 CRC（內容被就地改過）。 */
function fixPngChunkCrc(data: Buffer, position: number): void {
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > data.length) return;
    if (position >= dataStart && position < dataEnd) {
      data.writeUInt32BE(crc32(data.subarray(offset + 4, dataEnd)), dataEnd);
      return;
    }
    offset = dataEnd + 4;
  }
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
