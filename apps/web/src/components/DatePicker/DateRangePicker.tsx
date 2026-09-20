import { useState } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import { Popover } from '../Popover';
import { Calendar } from './Calendar';
import { parseDate } from './calendar-utils';
import type { DateValue } from './calendar-utils';

import './DatePicker.css';

export interface DateRange {
  from: DateValue;
  to: DateValue;
}

export interface DateRangePickerProps {
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
  ...rest
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

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
        trigger={
          <button
            type="button"
            className="ge-date-picker__trigger"
            disabled={disabled}
            aria-label={rest['aria-label'] ?? labels.open}
            data-testid={rest['data-testid']}
          >
            <Icon name="calendar" size={16} />
            <span
              className={cn('ge-date-picker__value', !value.from && 'ge-date-picker__value--empty')}
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
          data-testid="date-range-picker-calendar"
        />
      </Popover>

      {clearable && value.from && !disabled && (
        <button
          type="button"
          className="ge-date-picker__clear"
          aria-label={labels.clear}
          onClick={() => onValueChange({ from: null, to: null })}
          data-testid="date-range-picker-clear"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
