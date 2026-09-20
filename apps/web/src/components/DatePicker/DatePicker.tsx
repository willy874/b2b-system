import { useState } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import { Popover } from '../Popover';
import { Calendar } from './Calendar';
import type { DateValue } from './calendar-utils';

import './DatePicker.css';

export interface DatePickerProps {
  value: DateValue;
  onValueChange: (value: DateValue) => void;
  min?: DateValue;
  max?: DateValue;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  clearable?: boolean;
  locale?: string;
  /** 沒有選取值時初始顯示的月份（`YYYY-MM-DD`）。 */
  defaultMonth?: DateValue;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  labels?: { clear: string; open: string };
}

/**
 * 日期選擇器（Base UI 沒有這個元件，彈層用 Popover、日期運算用 dayjs）。
 * 值一律是 `YYYY-MM-DD` 字串，不是 Date：時區轉換是顯示層的事。
 */
export function DatePicker({
  value,
  onValueChange,
  min,
  max,
  placeholder = 'YYYY-MM-DD',
  disabled,
  invalid,
  clearable = true,
  locale,
  defaultMonth,
  className,
  labels = { clear: 'clear', open: 'open calendar' },
  ...rest
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('ge-date-picker', className)}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button
            type="button"
            className={cn('ge-date-picker__trigger', invalid && 'ge-date-picker__trigger--invalid')}
            disabled={disabled}
            aria-label={rest['aria-label'] ?? labels.open}
            data-testid={rest['data-testid']}
          >
            <Icon name="calendar" size={16} />
            <span className={cn('ge-date-picker__value', !value && 'ge-date-picker__value--empty')}>
              {value ?? placeholder}
            </span>
          </button>
        }
      >
        <Calendar
          selected={[value]}
          min={min}
          max={max}
          locale={locale}
          defaultMonth={defaultMonth}
          onSelect={(next) => {
            onValueChange(next);
            setOpen(false);
          }}
          data-testid="date-picker-calendar"
        />
      </Popover>

      {clearable && value && !disabled && (
        <button
          type="button"
          className="ge-date-picker__clear"
          aria-label={labels.clear}
          onClick={() => onValueChange(null)}
          data-testid="date-picker-clear"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
