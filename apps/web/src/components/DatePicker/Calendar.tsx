import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, Ref } from 'react';

import { cn } from '@/shared/utils';

import { IconButton } from '../Button';
import { Icon } from '../Icon';
import {
  buildMonthGrid,
  DATE_FORMAT,
  formatDate,
  isBetween,
  isOutOfRange,
  monthLabel,
  parseDate,
  weekdayLabels,
} from './calendar-utils';
import type { DateValue } from './calendar-utils';

import './Calendar.css';

export interface CalendarProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  /** 已選日期（單選傳一個，範圍傳頭尾）。 */
  selected: DateValue[];
  onSelect: (date: string) => void;
  min?: DateValue;
  max?: DateValue;
  locale?: string;
  /** 範圍選取時用來畫出中間區段。 */
  range?: { start: DateValue; end: DateValue };
  /** 沒有選取值時初始顯示的月份（預設為本月）。測試需要它才能不依賴「今天」。 */
  defaultMonth?: DateValue;
  labels?: { previousMonth: string; nextMonth: string };
  className?: string;
  'data-testid'?: string;
}

/** 月曆網格。鍵盤操作與 ARIA 由這裡負責（Base UI 沒有日曆元件）。 */
export function Calendar({
  selected,
  onSelect,
  min,
  max,
  locale = 'zh-TW',
  range,
  defaultMonth,
  labels = { previousMonth: 'previous month', nextMonth: 'next month' },
  className,
  ...rest
}: CalendarProps) {
  const firstSelected = parseDate(selected.find(Boolean) ?? null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackMonth = parseDate(defaultMonth ?? null) ?? dayjs();
  const [month, setMonth] = useState<Dayjs>((firstSelected ?? fallbackMonth).startOf('month'));
  const [focused, setFocused] = useState<Dayjs>(firstSelected ?? fallbackMonth);

  const grid = buildMonthGrid(month);

  // 焦點跟著 roving tabindex 走（鍵盤移動之後要真的聚焦到那一天）
  useEffect(() => {
    const container = containerRef.current;
    if (!container?.contains(document.activeElement)) return;
    const target = container.querySelector<HTMLButtonElement>(
      `[data-testid="calendar-day-${formatDate(focused)}"]`,
    );
    target?.focus();
  }, [focused]);
  const rangeStart = parseDate(range?.start ?? null);
  const rangeEnd = parseDate(range?.end ?? null);

  const moveFocus = (next: Dayjs) => {
    setFocused(next);
    if (!next.isSame(month, 'month')) setMonth(next.startOf('month'));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (event.key in moves) {
      event.preventDefault();
      moveFocus(focused.add(moves[event.key] as number, 'day'));
      return;
    }
    if (event.key === 'PageUp') {
      event.preventDefault();
      moveFocus(focused.subtract(1, 'month'));
      return;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      moveFocus(focused.add(1, 'month'));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      moveFocus(focused.startOf('month'));
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      moveFocus(focused.endOf('month'));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!isOutOfRange(focused, min ?? null, max ?? null)) onSelect(formatDate(focused));
    }
  };

  return (
    <div ref={containerRef} className={cn('ge-calendar', className)} {...rest}>
      <header className="ge-calendar__header">
        <IconButton
          aria-label={labels.previousMonth}
          size="sm"
          onClick={() => setMonth(month.subtract(1, 'month'))}
        >
          <Icon name="chevron-left" size={16} />
        </IconButton>
        <span className="ge-calendar__month" aria-live="polite">
          {monthLabel(month, locale)}
        </span>
        <IconButton
          aria-label={labels.nextMonth}
          size="sm"
          onClick={() => setMonth(month.add(1, 'month'))}
        >
          <Icon name="chevron-right" size={16} />
        </IconButton>
      </header>

      {/* 用真正的 <table>：語意正確，也不需要手動補 grid/row/gridcell 這些 role */}
      <table className="ge-calendar__grid">
        <caption className="ge-calendar__caption">{monthLabel(month, locale)}</caption>
        <thead>
          <tr className="ge-calendar__weekdays">
            {weekdayLabels(locale).map((label, index) => (
              <th scope="col" key={`${label}-${index}`} className="ge-calendar__weekday">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((week) => (
            <tr className="ge-calendar__week" key={week[0]?.format(DATE_FORMAT)}>
              {week.map((day) => {
                const value = formatDate(day);
                const isSelected = selected.some((item) => item === value);
                const disabled = isOutOfRange(day, min ?? null, max ?? null);
                const outside = !day.isSame(month, 'month');
                return (
                  <td key={value} className="ge-calendar__cell">
                    <button
                      type="button"
                      className={cn(
                        'ge-calendar__day',
                        outside && 'ge-calendar__day--outside',
                        isSelected && 'ge-calendar__day--selected',
                        isBetween(day, rangeStart, rangeEnd) && 'ge-calendar__day--in-range',
                        day.isSame(dayjs(), 'day') && 'ge-calendar__day--today',
                      )}
                      aria-pressed={isSelected}
                      aria-label={value}
                      disabled={disabled}
                      tabIndex={day.isSame(focused, 'day') ? 0 : -1}
                      onKeyDown={onKeyDown}
                      onClick={() => {
                        setFocused(day);
                        onSelect(value);
                      }}
                      data-testid={`calendar-day-${value}`}
                    >
                      {day.date()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
