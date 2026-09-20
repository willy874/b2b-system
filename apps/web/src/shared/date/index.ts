import { DEFAULT_TIMEZONE } from '@/shared/constants/lang';

export function formatDateTime(
  value: Date | string | null | undefined,
  options: { timeZone?: string; locale?: string } = {},
): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(options.locale ?? 'zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: options.timeZone ?? DEFAULT_TIMEZONE,
  }).format(date);
}

export function formatDate(
  value: Date | string | null | undefined,
  options: { timeZone?: string; locale?: string } = {},
): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(options.locale ?? 'zh-TW', {
    dateStyle: 'medium',
    timeZone: options.timeZone ?? DEFAULT_TIMEZONE,
  }).format(date);
}
