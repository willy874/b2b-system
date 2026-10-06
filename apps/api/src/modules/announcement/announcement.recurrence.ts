import type { AnnouncementRecurringTrigger } from '@/db/schema';

/**
 * 週期的計算（docs/architecture/backend/19-announcement.md §9.2 D7、D11）：純函式，只在後端算（前端的「接下來幾次」呼叫預覽端點），
 * DST 與月底的邊界只有一份實作。時區換算用 `Intl`（Node 24 沒有 `Temporal`）：先猜 UTC 再以該時刻的位移校正兩次，
 * 不存在的時段順延（`zonedInstant`），與前端 `shared/date` 的 `zonedDateTime` 同一個做法。
 *
 * 日曆的運算都在「沒有時區的日期」上做（以 UTC 的 00:00 表示一天），最後才換成那一天、那個時間在租戶時區的時刻。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** 往後最多找幾天：每 99 個月一次也在範圍內；超過就當作沒有下一次。 */
const SEARCH_LIMIT_DAYS = 366 * 10;

/** `YYYY-MM-DD` → 那一天的 UTC 00:00（毫秒）。 */
function parseDay(day: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, date);
}

/** 某一刻在 `timeZone` 的日曆日（UTC 00:00 表示）。 */
function localDayOf(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'));
}

/** `timeZone` 在某一刻相對 UTC 的位移（毫秒）。 */
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
 * 某一天（UTC 00:00 表示）的 `HH:mm` 在 `timeZone` 是哪一刻。
 * 不存在的時段（夏令時間開始時跳過的那一小時）以跳之前的位移換算，順延到跳之後（02:30 → 03:30）；
 * 重複的時段（夏令時間結束）取較早的一次。同 Temporal 的 `disambiguation: 'compatible'`。
 */
function zonedInstant(day: number, time: string, timeZone: string): Date {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const guess = day + hour * 60 * 60 * 1000 + minute * 60 * 1000;
  const first = guess - offsetOf(guess, timeZone);
  const result = guess - offsetOf(first, timeZone);
  if (result + offsetOf(result, timeZone) === guess) return new Date(result);
  // 換回當地時間對不上：落在不存在的時段，兩個候選取較晚的那一個（以跳之前的位移換算）
  return new Date(Math.max(result, guess - offsetOf(result, timeZone)));
}

function lastDayOfMonth(day: number): number {
  const date = new Date(day);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/** 週的起點（週日）；週期以 `startsOn` 那一週為第 0 週。 */
function weekStartOf(day: number): number {
  return day - new Date(day).getUTCDay() * DAY_MS;
}

/** 這一天符不符合週期的規則（不看時間、不看結束條件）。 */
function matches(trigger: AnnouncementRecurringTrigger, day: number, startsOn: number): boolean {
  if (day < startsOn) return false;
  const date = new Date(day);
  switch (trigger.frequency) {
    case 'daily':
      return Math.round((day - startsOn) / DAY_MS) % trigger.interval === 0;
    case 'weekly': {
      const weeks = Math.round((weekStartOf(day) - weekStartOf(startsOn)) / (7 * DAY_MS));
      return weeks % trigger.interval === 0 && (trigger.weekdays ?? []).includes(date.getUTCDay());
    }
    case 'monthly': {
      const start = new Date(startsOn);
      const months =
        (date.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        (date.getUTCMonth() - start.getUTCMonth());
      if (months % trigger.interval !== 0) return false;
      const target = trigger.monthDay === 'last' ? lastDayOfMonth(day) : (trigger.monthDay ?? 1);
      return date.getUTCDate() === target;
    }
  }
}

/**
 * `after` 之後（不含）的下一次發送；沒有了（過了結束日期）回 `undefined`。
 * 次數上限（`maxOccurrences`）由呼叫端依已發送的次數判斷：這裡只看日曆。
 */
export function nextOccurrence(
  trigger: AnnouncementRecurringTrigger,
  after: Date,
  timeZone: string,
): Date | undefined {
  const startsOn = parseDay(trigger.startsOn);
  const endsOn = trigger.endsOn ? parseDay(trigger.endsOn) : undefined;
  // 從前一天開始找：`after` 在租戶時區的那一天，時間可能還沒到
  const from = Math.max(startsOn, localDayOf(after, timeZone) - DAY_MS);
  for (let offset = 0; offset <= SEARCH_LIMIT_DAYS; offset += 1) {
    const day = from + offset * DAY_MS;
    if (endsOn !== undefined && day > endsOn) return undefined;
    if (!matches(trigger, day, startsOn)) continue;
    const instant = zonedInstant(day, trigger.time, timeZone);
    if (instant.getTime() > after.getTime()) return instant;
  }
  return undefined;
}

/** 從 `after` 起接下來最多 `count` 次（預覽用）；`remaining` 是次數上限還剩幾次。 */
export function upcomingOccurrences(
  trigger: AnnouncementRecurringTrigger,
  after: Date,
  timeZone: string,
  count: number,
  remaining = Number.POSITIVE_INFINITY,
): Date[] {
  const result: Date[] = [];
  let cursor = after;
  while (result.length < Math.min(count, remaining)) {
    const next = nextOccurrence(trigger, cursor, timeZone);
    if (!next) break;
    result.push(next);
    cursor = next;
  }
  return result;
}
