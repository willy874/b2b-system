import { useState } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import { Popover } from '../Popover';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Calendar } from './Calendar';
import { parseDate } from './calendar-utils';
import type { DateValue } from './calendar-utils';

import './DatePicker.css';

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
  placeholder = 'YYYY-MM-DD ~ YYYY-MM-DD',
  disabled,
  clearable = true,
  locale,
  defaultMonth,
  className,
  labels = { clear: 'clear', open: 'open calendar', separator: '~' },
  classNames,
  styles,
  testIds,
  ...rest
}: DateRangePickerProps) {
  const slot = createSlots({ classNames, styles, testIds });
  const [open, setOpen] = useState(false);
  const triggerSlot = slot('trigger', 'ge-date-picker__trigger');

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

  const label =
    value.from && value.to
      ? `${value.from} ${labels.separator} ${value.to}`
      : (value.from ?? placeholder);

  return (
    <div className={cn('ge-date-picker', 'ge-date-picker--range', className)}>
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
            <span
              {...slot('value', [
                'ge-date-picker__value',
                !value.from && 'ge-date-picker__value--empty',
              ])}
            >
              {label}
            </span>
          </button>
        }
      >
        <Calendar
          selected={[value.from, value.to]}
          range={{ start: value.from, end: value.to }}
          min={min}
          max={max}
          locale={locale}
          defaultMonth={defaultMonth}
          onSelect={handleSelect}
          {...slot('calendar', undefined, { testId: 'date-range-picker-calendar' })}
        />
      </Popover>

      {clearable && value.from && !disabled && (
        <button
          type="button"
          {...slot('clear', 'ge-date-picker__clear', { testId: 'date-range-picker-clear' })}
          aria-label={labels.clear}
          onClick={() => onValueChange({ from: null, to: null })}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
