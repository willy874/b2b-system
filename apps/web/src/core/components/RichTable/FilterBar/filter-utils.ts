import type { AnyFilterField, DateRangeFilterValue } from './types';

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isDateRangeValue(value: unknown): value is DateRangeFilterValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 欄位的值是否算「有篩選」：決定按鈕上的數量。 */
export function isFilterActive(field: AnyFilterField, value: unknown): boolean {
  switch (field.type) {
    case 'text':
    case 'select':
      return typeof value === 'string' && value !== '';
    case 'multiSelect':
      return isStringArray(value) && value.length > 0;
    case 'dateRange':
      return isDateRangeValue(value) && Boolean(value.from || value.to);
    case 'custom':
      return field.isActive ? field.isActive(value) : value !== undefined;
  }
}
