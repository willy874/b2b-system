import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

export const DATE_FORMAT = 'YYYY-MM-DD';

export type DateValue = string | null;

export function parseDate(value: DateValue): Dayjs | null {
  if (!value) return null;
  const parsed = dayjs(value, DATE_FORMAT);
  return parsed.isValid() ? parsed : null;
}

export function formatDate(value: Dayjs): string {
  return value.format(DATE_FORMAT);
}

export function isBetween(value: Dayjs, start: Dayjs | null, end: Dayjs | null): boolean {
  if (!start || !end) return false;
  return value.isAfter(start, 'day') && value.isBefore(end, 'day');
}

export function isOutOfRange(value: Dayjs, min: DateValue, max: DateValue): boolean {
  const minDate = parseDate(min);
  const maxDate = parseDate(max);
  if (minDate && value.isBefore(minDate, 'day')) return true;
  if (maxDate && value.isAfter(maxDate, 'day')) return true;
  return false;
}

/** 回傳月曆網格：補滿前後月份，固定 6 週 × 7 天。 */
export function buildMonthGrid(month: Dayjs, weekStartsOn = 0): Dayjs[][] {
  const firstOfMonth = month.startOf('month');
  const offset = (firstOfMonth.day() - weekStartsOn + 7) % 7;
  const gridStart = firstOfMonth.subtract(offset, 'day');

  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (__, day) => gridStart.add(week * 7 + day, 'day')),
  );
}

export function weekdayLabels(locale: string, weekStartsOn = 0): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(Date.UTC(2023, 0, 1 + ((index + weekStartsOn) % 7)))),
  );
}

export function monthLabel(month: Dayjs, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(month.toDate());
}
