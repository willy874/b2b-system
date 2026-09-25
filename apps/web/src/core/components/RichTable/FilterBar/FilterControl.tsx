import { Checkbox } from '@/components/Checkbox';
import { DateRangePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { useTranslation } from '@/core/locales';

import { isDateRangeValue, isStringArray } from './filter-utils';
import { SortControl } from './SortControl';
import type {
  AnyFilterField,
  DateRangeFilterField,
  MultiSelectFilterField,
  SelectFilterField,
  TextFilterField,
} from './types';

import styles from './FilterBar.module.css';

/** `select` 以空字串代表「全部」，寫回草稿時轉成 `undefined`。 */
const ALL_VALUE = '';

interface ControlProps<TField> {
  field: TField;
  /** 草稿裡這個欄位的值；外部型別由 `FilterField<TValues>` 保證，這裡只做執行期的防禦。 */
  value: unknown;
  onChange: (value: unknown) => void;
}

/** 篩選面板裡單一欄位的控制項，依欄位型別切換。只改草稿，送出由 `FilterBar` 負責。 */
export function FilterControl({ field, value, onChange }: ControlProps<AnyFilterField>) {
  switch (field.type) {
    case 'text':
      return <TextControl field={field} value={value} onChange={onChange} />;
    case 'select':
      return <SelectControl field={field} value={value} onChange={onChange} />;
    case 'multiSelect':
      return <MultiSelectControl field={field} value={value} onChange={onChange} />;
    case 'dateRange':
      return <DateRangeControl field={field} value={value} onChange={onChange} />;
    case 'sort':
      return <SortControl field={field} value={value} onChange={onChange} />;
    case 'custom':
      return field.render({ value, onChange });
  }
}

function TextControl({ field, value, onChange }: ControlProps<TextFilterField>) {
  return (
    <Input
      size="sm"
      value={typeof value === 'string' ? value : ''}
      placeholder={field.placeholder}
      disabled={field.disabled}
      aria-label={field.label}
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  );
}

function SelectControl({ field, value, onChange }: ControlProps<SelectFilterField>) {
  const { t } = useTranslation();
  return (
    <Select
      size="sm"
      value={typeof value === 'string' ? value : ALL_VALUE}
      onValueChange={(next) => onChange(next === ALL_VALUE ? undefined : next)}
      options={[{ value: ALL_VALUE, label: field.allLabel ?? t('common.all') }, ...field.options]}
      disabled={field.disabled}
      aria-label={field.label}
    />
  );
}

function MultiSelectControl({ field, value, onChange }: ControlProps<MultiSelectFilterField>) {
  const selected = isStringArray(value) ? value : [];
  const toggle = (item: string, checked: boolean) => {
    const next = checked ? [...selected, item] : selected.filter((other) => other !== item);
    onChange(next.length ? next : undefined);
  };

  return (
    <fieldset className={styles.checkboxList} aria-label={field.label}>
      {field.options.map((option) => (
        <Checkbox
          key={option.value}
          label={option.label}
          checked={selected.includes(option.value)}
          onCheckedChange={(checked) => toggle(option.value, checked)}
          disabled={field.disabled}
          data-value={option.value}
        />
      ))}
    </fieldset>
  );
}

function DateRangeControl({ field, value, onChange }: ControlProps<DateRangeFilterField>) {
  const { t } = useTranslation();
  const range = isDateRangeValue(value) ? value : {};
  return (
    <DateRangePicker
      value={{ from: range.from ?? null, to: range.to ?? null }}
      onValueChange={({ from, to }) =>
        onChange(from || to ? { from: from ?? undefined, to: to ?? undefined } : undefined)
      }
      min={field.min}
      max={field.max}
      maxSpanDays={field.maxSpanDays}
      disabled={field.disabled}
      aria-label={field.label}
      labels={{ clear: t('common.clear'), open: field.label, separator: '~' }}
      data-testid="filter-bar-date-range"
    />
  );
}
