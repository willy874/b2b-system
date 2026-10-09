import type { ExifFields } from '@/core/image';
import type { GalleryExif } from '@/db/schema';

/** EXIF 的時間：`YYYY:MM:DD HH:MM:SS`（有些相機用 `-` 或空白分隔日期，一併接受）。 */
const EXIF_DATE_TIME = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
/** `+08:00`、`-0530`、`Z`。 */
const EXIF_OFFSET = /^(?:Z|([+-])(\d{2}):?(\d{2}))$/;

/** 年份的合理範圍：相機沒設時間時常寫 `0000:00:00` 或 1970 年，不要讓它排在時間軸的最前面。 */
const MIN_YEAR = 1900;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parseWallClock(value: string): WallClock | undefined {
  const match = EXIF_DATE_TIME.exec(value.trim());
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < MIN_YEAR || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  // 2026:02:30 這種不存在的日期：Date.UTC 會進位到 3 月，格式化回來就對不上
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1) return undefined;
  return { year, month, day, hour, minute, second };
}

function offsetMinutesOf(value: string): number | undefined {
  const match = EXIF_OFFSET.exec(value.trim());
  if (!match) return undefined;
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  if (minutes > 14 * 60) return undefined;
  return match[1] === '-' ? -minutes : minutes;
}

/** `timeZone` 在 `instant` 那一刻相對於 UTC 的偏移（分鐘）。 */
function zoneOffsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - instant) / 60_000);
}

/**
 * 當地時間 → UTC（`Intl` 兩次校正，同公告的週期計算）：先以 UTC 當作猜測，算出那一刻的偏移再修正一次；
 * 修正後跨過日光節約的邊界時，以第二次的偏移為準。
 */
export function wallClockToUtc(clock: WallClock, timeZone: string): Date {
  const naive = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  const first = naive - zoneOffsetMinutes(naive, timeZone) * 60_000;
  const second = naive - zoneOffsetMinutes(first, timeZone) * 60_000;
  return new Date(second);
}

/**
 * 拍攝時間（docs/architecture/backend/26-gallery.md §5）：`DateTimeOriginal` 有時區偏移（`OffsetTimeOriginal`）時換算成 UTC；
 * 沒有時以租戶的預設時區解讀。讀不出來回 null（時間軸改用上傳時間）。
 */
export function takenAtOf(fields: ExifFields, defaultTimeZone: string): Date | null {
  if (!fields.dateTimeOriginal) return null;
  const clock = parseWallClock(fields.dateTimeOriginal);
  if (!clock) return null;
  const offset = fields.offsetTimeOriginal ? offsetMinutesOf(fields.offsetTimeOriginal) : undefined;
  if (offset !== undefined) {
    const naive = Date.UTC(
      clock.year,
      clock.month - 1,
      clock.day,
      clock.hour,
      clock.minute,
      clock.second,
    );
    return new Date(naive - offset * 60_000);
  }
  return wallClockToUtc(clock, defaultTimeZone);
}

/** 正數四捨五入到 `digits` 位；沒有值、非正數回 undefined。 */
function round(value: number | undefined, digits: number): number | undefined {
  return value === undefined || !Number.isFinite(value) || value <= 0
    ? undefined
    : Math.round(value * 10 ** digits) / 10 ** digits;
}

/** 存進 `gallery_items.exif` 的欄位：只留有值的、去掉 GPS（D5），數字四捨五入到顯示需要的精度。 */
export function toGalleryExif(fields: ExifFields): GalleryExif | null {
  const exif: GalleryExif = {
    make: fields.make,
    model: fields.model,
    lensMake: fields.lensMake,
    lensModel: fields.lensModel,
    focalLength: round(fields.focalLength, 1),
    focalLength35mm: round(fields.focalLength35mm, 0),
    fNumber: round(fields.fNumber, 1),
    exposureTime: round(fields.exposureTime, 6),
    iso: round(fields.iso, 0),
    flashFired: fields.flashFired,
  };
  const present = Object.fromEntries(
    Object.entries(exif).filter(([, value]) => value !== undefined),
  ) as GalleryExif;
  return Object.keys(present).length > 0 ? present : null;
}
