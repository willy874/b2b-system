import { DEFAULT_LANGUAGE, DEFAULT_TIMEZONE } from '../constants/lang';

export interface DateTimeFormatOptions {
  timeZone?: string;
  locale?: string;
}

/**
 * 沒有明確傳入時使用的語系與時區：由 i18n plugin 依使用者偏好（語言、時區）設定，
 * 全站 `formatDateTime()` 不必各自傳 options 就跟著偏好走。
 */
const defaults: Required<DateTimeFormatOptions> = {
  locale: DEFAULT_LANGUAGE,
  timeZone: DEFAULT_TIMEZONE,
};

/** 更新預設的語系與時區（i18n plugin 在初始化與偏好變更時呼叫）。不合法的時區忽略。 */
export function setDateTimeDefaults(next: DateTimeFormatOptions): void {
  if (next.locale) defaults.locale = next.locale;
  if (next.timeZone && isValidTimeZone(next.timeZone)) defaults.timeZone = next.timeZone;
}

export function getDateTimeDefaults(): Readonly<Required<DateTimeFormatOptions>> {
  return { ...defaults };
}

/** 是不是瀏覽器認得的 IANA 時區（`Asia/Taipei`、`UTC`…）。 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    // RangeError：不認得的時區
    return false;
  }
}

/**
 * 偏好裡的時區來自後端與 localStorage，可能不是合法值：`Intl` 會丟 RangeError 讓整頁壞掉，
 * 這裡退回預設時區。
 */
function createFormat(
  options: DateTimeFormatOptions,
  style: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const locale = options.locale ?? defaults.locale;
  const timeZone = options.timeZone ?? defaults.timeZone;
  try {
    return new Intl.DateTimeFormat(locale, { ...style, timeZone });
  } catch {
    // 時區或語系不合法：退回預設值
    return new Intl.DateTimeFormat(DEFAULT_LANGUAGE, { ...style, timeZone: DEFAULT_TIMEZONE });
  }
}

function toDate(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function formatDateTime(
  value: Date | string | null | undefined,
  options: DateTimeFormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return '-';
  return createFormat(options, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatDate(
  value: Date | string | null | undefined,
  options: DateTimeFormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return '-';
  return createFormat(options, { dateStyle: 'medium' }).format(date);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * 相對時間（「3 分鐘前」「昨天」），以偏好的語系顯示；一分鐘內是「現在」。未來的時間同樣適用（「5 分鐘後」）。
 * 取最大且至少一個單位的時間單位，四捨五入到整數（`numeric: 'auto'` 讓 1 天前顯示成「昨天」）。
 */
export function formatRelativeTime(
  value: Date | string | null | undefined,
  now: number = Date.now(),
  options: Pick<DateTimeFormatOptions, 'locale'> = {},
): string {
  const date = toDate(value);
  if (!date) return '-';
  const diff = date.getTime() - now;
  let format: Intl.RelativeTimeFormat;
  try {
    format = new Intl.RelativeTimeFormat(options.locale ?? defaults.locale, { numeric: 'auto' });
  } catch {
    // 語系不合法：退回預設語系
    format = new Intl.RelativeTimeFormat(DEFAULT_LANGUAGE, { numeric: 'auto' });
  }
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit);
  }
  return format.format(0, 'second');
}

/** `timeZone` 在 `instant` 這一刻相對 UTC 的位移（毫秒，東區為正）。 */
function offsetOf(instant: number, timeZone: string): number {
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
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * 當地的日期時間（以同樣數字的 UTC 毫秒表示）在 `timeZone` 是哪一刻；位移在當天變動（夏令時間）時再校正一次。
 * 不存在的時段（夏令時間開始時跳過的那一段）順延到跳之後（02:30 → 03:30），重複的時段取較早的一次，
 * 同 Temporal 的 `disambiguation: 'compatible'`；後端公告週期的 `zonedInstant` 是同一個算法。
 */
function wallClockToInstant(wallClock: number, timeZone: string): number {
  const first = wallClock - offsetOf(wallClock, timeZone);
  const result = wallClock - offsetOf(first, timeZone);
  if (result + offsetOf(result, timeZone) === wallClock) return result;
  // 換回當地時間對不上：落在不存在的時段，兩個候選取較晚的那一個（以跳之前的位移換算）
  return Math.max(result, wallClock - offsetOf(result, timeZone));
}

/** 某時區某一天 00:00 的時刻（UTC 毫秒）；00:00 不存在（午夜切換夏令時間）時是跳之後的第一刻。 */
function startOfDay(day: string, timeZone: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return wallClockToInstant(Date.UTC(year, month - 1, date), timeZone);
}

/**
 * 日期篩選（`YYYY-MM-DD`）的日界線，以使用者偏好的時區計算，與列表顯示的時間一致。
 * `start` 是當天 00:00:00.000，`end` 是當天 23:59:59.999；回傳 ISO 字串。
 */
export function zonedDayBoundary(
  day: string,
  edge: 'start' | 'end',
  timeZone: string = defaults.timeZone,
): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  if (edge === 'start') return new Date(startOfDay(day, zone)).toISOString();
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
  return new Date(startOfDay(next, zone) - 1).toISOString();
}

/**
 * 日期（`YYYY-MM-DD`）＋ 時間（`HH:mm`）在使用者偏好的時區裡的那一刻，回傳 ISO 字串；格式不對回 `undefined`。
 * 排程的時間以偏好的時區輸入，與列表顯示的時間一致；夏令時間的處理見 `wallClockToInstant`。
 */
export function zonedDateTime(
  day: string,
  time: string,
  timeZone: string = defaults.timeZone,
): string | undefined {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dayMatch || !timeMatch) return undefined;
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const [, year, month, date] = dayMatch.map(Number) as [number, number, number, number];
  const [, hour, minute] = timeMatch.map(Number) as [number, number, number];
  return new Date(
    wallClockToInstant(Date.UTC(year, month - 1, date, hour, minute), zone),
  ).toISOString();
}

/** `zonedDateTime` 的反向：某一刻在偏好時區的日期與時間（編輯排程時帶回表單）。 */
export function toZonedParts(
  value: string,
  timeZone: string = defaults.timeZone,
): { day: string; time: string } | undefined {
  const date = toDate(value);
  if (!date) return undefined;
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

/**
 * 某個時區（預設是使用者偏好的時區）此刻的日期 `YYYY-MM-DD`：日期選擇器的「今天」、最早可選的日期。
 * 不用 dayjs()／new Date() 的本地日期——那是瀏覽器的時區，出差或電腦設成 UTC 時會差一天。
 */
export function todayInZone(timeZone: string = defaults.timeZone, now: Date = new Date()): string {
  return toZonedParts(now.toISOString(), timeZone)?.day ?? now.toISOString().slice(0, 10);
}
