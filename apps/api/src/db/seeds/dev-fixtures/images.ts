import sharp from 'sharp';
import type { WriteableMetadata } from 'sharp';

/**
 * 假資料的圖片與檔案內容：全部在程式裡產生（漸層、色塊加文字），不下載、不把圖檔放進 repo。
 * 同一份規格永遠產生同一份位元組：色彩與形狀來自規格裡的 `seed`，不讀時間也不讀亂數。
 */

export type PhotoFormat = 'jpeg' | 'png' | 'webp';

/** 寫進 EXIF 的相機資訊（docs/architecture/backend/26-gallery.md §5）。 */
export interface PhotoCamera {
  make: string;
  model: string;
  lensMake?: string;
  lensModel?: string;
  focalLength: number;
  focalLength35mm?: number;
  fNumber: number;
  /** 秒。 */
  exposureTime: number;
  iso: number;
  flashFired?: boolean;
}

/** 十進位度數；寫成 EXIF 的度、分、秒有理數。 */
export interface PhotoLocation {
  latitude: number;
  longitude: number;
}

export interface PhotoExif {
  /** 拍攝當地的時間 `YYYY:MM:DD HH:MM:SS`。 */
  dateTimeOriginal: string;
  /** `+08:00`；省略時 api 以租戶的預設時區解讀（§5.2）。 */
  offsetTimeOriginal?: string;
  camera?: PhotoCamera;
  location?: PhotoLocation;
}

export interface PhotoSpec {
  width: number;
  height: number;
  format: PhotoFormat;
  /** 決定配色與色塊的位置。 */
  seed: number;
  /** 畫在圖上的字（只用 ASCII：不依賴環境裡有沒有中文字型）。 */
  label: string;
  exif?: PhotoExif;
}

/** 十進位度數 → EXIF 的 `度/1 分/1 秒*100/100`。 */
export function toDmsRational(value: number): string {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.round((minutesFloat - minutes) * 60 * 100);
  return `${degrees}/1 ${minutes}/1 ${seconds}/100`;
}

/** 秒 → EXIF 的有理數（快門 1/250 秒寫成 `1/250`）。 */
function toRational(value: number): string {
  if (value >= 1) return `${Math.round(value * 10)}/10`;
  return `1/${Math.round(1 / value)}`;
}

/** 規格 → sharp `withExif` 的參數（IFD0 是相機、IFD2 是 Exif 子 IFD、IFD3 是 GPS）。 */
export function toSharpExif(exif: PhotoExif): WriteableMetadata['exif'] {
  const ifd0: Record<string, string> = {};
  const ifd2: Record<string, string> = { DateTimeOriginal: exif.dateTimeOriginal };
  if (exif.offsetTimeOriginal) ifd2.OffsetTimeOriginal = exif.offsetTimeOriginal;
  const camera = exif.camera;
  if (camera) {
    ifd0.Make = camera.make;
    ifd0.Model = camera.model;
    if (camera.lensMake) ifd2.LensMake = camera.lensMake;
    if (camera.lensModel) ifd2.LensModel = camera.lensModel;
    ifd2.FocalLength = `${Math.round(camera.focalLength * 10)}/10`;
    if (camera.focalLength35mm) ifd2.FocalLengthIn35mmFilm = String(camera.focalLength35mm);
    ifd2.FNumber = `${Math.round(camera.fNumber * 10)}/10`;
    ifd2.ExposureTime = toRational(camera.exposureTime);
    ifd2.ISOSpeedRatings = String(camera.iso);
    ifd2.Flash = camera.flashFired ? '1' : '0';
  }
  const result: NonNullable<WriteableMetadata['exif']> = { IFD0: ifd0, IFD2: ifd2 };
  const location = exif.location;
  if (location) {
    result.IFD3 = {
      GPSLatitudeRef: location.latitude >= 0 ? 'N' : 'S',
      GPSLatitude: toDmsRational(location.latitude),
      GPSLongitudeRef: location.longitude >= 0 ? 'E' : 'W',
      GPSLongitude: toDmsRational(location.longitude),
    };
  }
  return result;
}

/** 由 `seed` 推出的固定配色：兩個色相做背景漸層，第三個做色塊。 */
function paletteOf(seed: number): { from: string; to: string; accent: string } {
  const hue = (seed * 47) % 360;
  return {
    from: `hsl(${hue}, 62%, 58%)`,
    to: `hsl(${(hue + 70) % 360}, 58%, 32%)`,
    accent: `hsl(${(hue + 180) % 360}, 70%, 70%)`,
  };
}

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** 圖片內容的 SVG：漸層、幾個半透明的圓、左下角的文字。 */
export function photoSvg(spec: Pick<PhotoSpec, 'width' | 'height' | 'seed' | 'label'>): string {
  const { width, height, seed } = spec;
  const palette = paletteOf(seed);
  const short = Math.min(width, height);
  const circles = Array.from({ length: 4 }, (_, index) => {
    const step = seed * 31 + index * 97;
    const cx = Math.round(((step * 13) % 100) * (width / 100));
    const cy = Math.round(((step * 7) % 100) * (height / 100));
    const r = Math.round(short * (0.12 + (step % 5) * 0.05));
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${palette.accent}" fill-opacity="${0.18 + index * 0.08}"/>`;
  }).join('');
  const fontSize = Math.round(short / 12);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0" stop-color="${palette.from}"/><stop offset="1" stop-color="${palette.to}"/>`,
    '</linearGradient></defs>',
    `<rect width="${width}" height="${height}" fill="url(#g)"/>`,
    circles,
    `<text x="${Math.round(fontSize * 0.8)}" y="${height - Math.round(fontSize * 0.9)}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff" fill-opacity="0.92">${escapeXml(spec.label)}</text>`,
    '</svg>',
  ].join('');
}

const CONTENT_TYPE: Readonly<Record<PhotoFormat, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function photoContentType(format: PhotoFormat): string {
  return CONTENT_TYPE[format];
}

/** 依規格產生圖片（含 EXIF）。 */
export async function renderPhoto(spec: PhotoSpec): Promise<Buffer> {
  let image = sharp(Buffer.from(photoSvg(spec)));
  if (spec.format === 'jpeg') image = image.jpeg({ quality: 82 });
  else if (spec.format === 'png') image = image.png({ compressionLevel: 9 });
  else image = image.webp({ quality: 80 });
  if (spec.exif) image = image.withExif(toSharpExif(spec.exif) ?? {});
  return image.toBuffer();
}

/** 向量圖（檔案管理的非點陣圖：「加入圖片庫」會略過它）。 */
export function logoSvg(label: string, seed: number): string {
  const palette = paletteOf(seed);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">',
    `<rect width="240" height="120" rx="16" fill="${palette.to}"/>`,
    `<circle cx="60" cy="60" r="36" fill="${palette.accent}"/>`,
    `<text x="110" y="70" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#ffffff">${escapeXml(label)}</text>`,
    '</svg>',
    '',
  ].join('\n');
}

/**
 * 一頁、只有一行字的 PDF（只用 ASCII）。手寫最小的結構：xref 的位移由實際的位元組數算出，閱讀器才打得開。
 */
export function minimalPdf(text: string): Buffer {
  const safe = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 24 Tf 72 720 Td (${safe}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
