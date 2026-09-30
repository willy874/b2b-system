import { IconButton } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { useTranslation } from '@/core/locales';

import type { FilterBarProps } from './FilterBar';
import { isDateRangeValue, isFilterActive, isStringArray } from './FilterBar/filter-utils';
import type { AnyFilterField } from './FilterBar/types';

/** 套用中、可以一鍵移除的篩選條件（排序不是篩選，不列出）。 */
export function activeFilterFields<TValues extends Record<string, unknown>>(
  filters: FilterBarProps<TValues> | undefined,
): AnyFilterField[] {
  if (!filters) return [];
  return (filters.fields as AnyFilterField[]).filter(
    (field) =>
      field.type !== 'sort' &&
      isFilterActive(field, filters.value[field.key], filters.defaultValue?.[field.key]),
  );
}

/** 條件套用後的值 → 給人看的文字。 */
function describe(
  field: AnyFilterField,
  value: unknown,
  list: Intl.ListFormat,
): string | undefined {
  switch (field.type) {
    case 'text':
      return typeof value === 'string' ? value : undefined;
    case 'select':
      return field.options.find((option) => option.value === value)?.label;
    case 'multiSelect':
      return isStringArray(value)
        ? list.format(
            field.options
              .filter((option) => value.includes(option.value))
              .map((option) => option.label),
          )
        : undefined;
    case 'dateRange':
      return isDateRangeValue(value) ? `${value.from ?? ''} – ${value.to ?? ''}` : undefined;
    default:
      return undefined;
  }
}

interface ActiveFiltersProps<TValues extends Record<string, unknown>> {
  filters: FilterBarProps<TValues>;
}

/**
 * 以 Chip 列出套用中的篩選，每個都能單獨移除；不必打開篩選面板才知道目前的條件
 */
export function ActiveFilters<TValues extends Record<string, unknown>>({
  filters,
}: ActiveFiltersProps<TValues>) {
  const { t, language } = useTranslation();
  const list = new Intl.ListFormat(language || undefined, { type: 'conjunction' });
  const fields = activeFilterFields(filters);
  if (fields.length === 0) return null;

  const remove = (key: string) =>
    filters.onSubmit({ ...filters.value, [key]: filters.defaultValue?.[key] });

  return (
    <ul
      className="m-0 flex list-none flex-wrap items-center gap-2 p-0"
      data-testid="active-filters"
    >
      {fields.map((field) => {
        const text = describe(field, filters.value[field.key], list);
        const name = text
          ? t('common.filterChip', { label: field.label, value: text })
          : field.label;
        return (
          <li
            key={field.key}
            className="flex items-center"
            data-testid="active-filter"
            data-value={field.key}
          >
            <Chip tone="brand">{name}</Chip>
            <IconButton
              size="sm"
              aria-label={t('common.removeFilter', { name })}
              onClick={() => remove(field.key)}
              data-testid="active-filter-remove"
              data-value={field.key}
            >
              <Icon name="close" size={14} />
            </IconButton>
          </li>
        );
      })}
    </ul>
  );
}
