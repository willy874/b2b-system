import { DEFAULT_LANGUAGE, DEFAULT_TIMEZONE } from '@/shared/constants/lang';

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

/** 某時區某一天 00:00 的時刻（UTC 毫秒）；位移在當天變動（夏令時間）時再校正一次。 */
function startOfDay(day: string, timeZone: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, date);
  const first = guess - offsetOf(guess, timeZone);
  return guess - offsetOf(first, timeZone);
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
