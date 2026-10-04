import { useState } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import { Popover } from '../Popover';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Calendar } from './Calendar';
import { formatDate, parseDate } from './calendar-utils';
import type { DateValue } from './calendar-utils';

import styles from './DatePicker.module.css';

export interface DateRange {
  from: DateValue;
  to: DateValue;
}

/**
 * `className` 落在外框，`data-testid` / `aria-label` 落在 `trigger`；
 * 其餘各層用 `classNames` / `styles` / `testIds` 覆寫。
 */
export type DateRangePickerSlot = 'trigger' | 'icon' | 'value' | 'popup' | 'calendar' | 'clear';

export interface DateRangePickerProps extends SlotOverrides<DateRangePickerSlot> {
  value: DateRange;
  onValueChange: (value: DateRange) => void;
  min?: DateValue;
  max?: DateValue;
  /** 區間最多涵蓋幾天（含頭尾）。選了起點之後，超過的日期不可選。 */
  maxSpanDays?: number;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  locale?: string;
  /** 沒有選取值時初始顯示的月份（`YYYY-MM-DD`）。 */
  defaultMonth?: DateValue;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  labels?: { clear: string; open: string; separator: string };
}

/** 兩段式選取：第一次點選設定起點，第二次設定終點（早於起點時重設起點）。 */
export function DateRangePicker({
  value,
  onValueChange,
  min,
  max,
  maxSpanDays,
  placeholder = 'YYYY-MM-DD ~ YYYY-MM-DD',
  disabled,
  clearable = true,
  locale,
  defaultMonth,
  className,
  labels = { clear: 'clear', open: 'open calendar', separator: '~' },
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: DateRangePickerProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const [open, setOpen] = useState(false);
  const triggerSlot = slot('trigger', styles.trigger);

  const handleSelect = (next: string) => {
    const from = parseDate(value.from);
    const picked = parseDate(next);

    if (!from || value.to || (picked && from && picked.isBefore(from, 'day'))) {
      onValueChange({ from: next, to: null });
      return;
    }
    onValueChange({ from: value.from, to: next });
    setOpen(false);
  };

  const effectiveMax = spanLimitedMax(value, max ?? null, maxSpanDays);

  const label =
    value.from && value.to
      ? `${value.from} ${labels.separator} ${value.to}`
      : (value.from ?? placeholder);

  return (
    <div className={cn(styles.root, className)}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        {...slot('popup')}
        trigger={
          <button
            type="button"
            {...triggerSlot}
            disabled={disabled}
            aria-label={rest['aria-label'] ?? labels.open}
            data-testid={rest['data-testid'] ?? triggerSlot['data-testid']}
          >
            <Icon name="calendar" size={16} {...slot('icon')} />
            <span {...slot('value', styles.value)} data-empty={!value.from || undefined}>
              {label}
            </span>
          </button>
        }
      >
        <Calendar
          selected={[value.from, value.to]}
          range={{ start: value.from, end: value.to }}
          min={min}
          max={effectiveMax}
          locale={locale}
          defaultMonth={defaultMonth}
          onSelect={handleSelect}
          {...slot('calendar', undefined, { testId: 'date-range-picker-calendar' })}
        />
      </Popover>

      {clearable && value.from && !disabled && (
        <button
          type="button"
          {...slot('clear', styles.clear, { testId: 'date-range-picker-clear' })}
          aria-label={labels.clear}
          onClick={() => onValueChange({ from: null, to: null })}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

/** 只選了起點時，終點不能超過「起點 + maxSpanDays − 1」；與原本的 `max` 取較早者。 */
function spanLimitedMax(value: DateRange, max: DateValue, maxSpanDays?: number): DateValue {
  const from = parseDate(value.from);
  if (!maxSpanDays || !from || value.to) return max;
  const spanMax = from.add(maxSpanDays - 1, 'day');
  const original = parseDate(max);
  return original && original.isBefore(spanMax, 'day') ? max : formatDate(spanMax);
}
