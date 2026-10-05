import { isSortOrder } from '@b2b-system/web-shared/constants';
import type { SortEntry } from '@b2b-system/web-shared/constants';

import type { AnyFilterField, DateRangeFilterValue } from './types';

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isDateRangeValue(value: unknown): value is DateRangeFilterValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSortEntries(value: unknown): value is SortEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).sort === 'string' &&
        isSortOrder((item as Record<string, unknown>).order),
    )
  );
}

/**
 * 欄位的值是否算「有篩選」：決定按鈕上的數量。
 * 排序永遠有值（預設排序），所以與 `defaultValue` 不同才算。
 */
export function isFilterActive(
  field: AnyFilterField,
  value: unknown,
  defaultValue?: unknown,
): boolean {
  switch (field.type) {
    case 'text':
    case 'select':
      return typeof value === 'string' && value !== '';
    case 'multiSelect':
      return isStringArray(value) && value.length > 0;
    case 'dateRange':
      return isDateRangeValue(value) && Boolean(value.from || value.to);
    case 'sort':
      return isSortEntries(value) && value.length > 0 && !isSameSort(value, defaultValue);
    case 'custom':
      return field.isActive ? field.isActive(value) : value !== undefined;
  }
}

function isSameSort(value: SortEntry[], other: unknown): boolean {
  return (
    isSortEntries(other) &&
    value.length === other.length &&
    value.every(
      (entry, index) => entry.sort === other[index]?.sort && entry.order === other[index]?.order,
    )
  );
}
