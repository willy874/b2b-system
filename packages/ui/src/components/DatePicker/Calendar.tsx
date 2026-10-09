import { cn } from '@b2b-system/web-shared/utils';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, Ref } from 'react';

import { IconButton } from '../Button';
import { Icon } from '../Icon';
import { useComponentLabels } from '../labels';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
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

import styles from './Calendar.module.css';

/** `className` / `style` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type CalendarSlot =
  | 'header'
  | 'previousButton'
  | 'month'
  | 'nextButton'
  | 'grid'
  | 'caption'
  | 'weekdays'
  | 'weekday'
  | 'week'
  | 'cell'
  | 'day';

export interface CalendarProps extends SlotOverrides<CalendarSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  /** 已選日期（單選傳一個，範圍傳頭尾）。 */
  selected: DateValue[];
  onSelect: (date: string) => void;
  min?: DateValue;
  max?: DateValue;
  /** 月份標題與星期的語系；沒有傳時用 `ComponentLabelsContext` 的 `locale`（目前的介面語系）。 */
  locale?: string;
  /** 範圍選取時用來畫出中間區段。 */
  range?: { start: DateValue; end: DateValue };
  /** 沒有選取值時初始顯示的月份（預設為本月）。測試需要它才能不依賴「今天」。 */
  defaultMonth?: DateValue;
  /** 沒有傳的鍵用 `ComponentLabelsContext` 的文案。 */
  labels?: CalendarLabels;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

export interface CalendarLabels {
  previousMonth?: string;
  nextMonth?: string;
}

/** 月曆網格。鍵盤操作與 ARIA 由這裡負責（Base UI 沒有日曆元件）。 */
export function Calendar({
  selected,
  onSelect,
  min,
  max,
  locale: localeProp,
  range,
  defaultMonth,
  labels,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: CalendarProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const componentLabels = useComponentLabels();
  const locale = localeProp ?? componentLabels.locale;
  const previousMonthLabel = labels?.previousMonth ?? componentLabels.calendarPreviousMonth;
  const nextMonthLabel = labels?.nextMonth ?? componentLabels.calendarNextMonth;
  const firstSelected = parseDate(selected.find(Boolean) ?? null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackMonth = parseDate(defaultMonth ?? null) ?? dayjs();
  const [month, setMonth] = useState<Dayjs>((firstSelected ?? fallbackMonth).startOf('month'));
  const [focused, setFocused] = useState<Dayjs>(firstSelected ?? fallbackMonth);

  const grid = buildMonthGrid(month);

  // 這次的 focused 變動來自鍵盤。不能用「焦點在容器內」判斷：跨月時原本有焦點的那一天被卸載，焦點已經掉到 body
  const focusFromKeyboard = useRef(false);

  // 焦點跟著 roving tabindex 走（鍵盤移動之後要真的聚焦到那一天）
  useEffect(() => {
    if (!focusFromKeyboard.current) return;
    focusFromKeyboard.current = false;
    const target = containerRef.current?.querySelector<HTMLButtonElement>(
      `button[data-value="${formatDate(focused)}"]`,
    );
    target?.focus();
  }, [focused]);
  const rangeStart = parseDate(range?.start ?? null);
  const rangeEnd = parseDate(range?.end ?? null);

  const moveFocus = (next: Dayjs) => {
    focusFromKeyboard.current = true;
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
    <div ref={containerRef} className={cn(styles.root, className)} {...rest}>
      <header {...slot('header', styles.header)}>
        <IconButton
          aria-label={previousMonthLabel}
          size="sm"
          onClick={() => setMonth(month.subtract(1, 'month'))}
          {...slot('previousButton')}
        >
          <Icon name="chevron-left" size={16} />
        </IconButton>
        <span {...slot('month', styles.month)} aria-live="polite">
          {monthLabel(month, locale)}
        </span>
        <IconButton
          aria-label={nextMonthLabel}
          size="sm"
          onClick={() => setMonth(month.add(1, 'month'))}
          {...slot('nextButton')}
        >
          <Icon name="chevron-right" size={16} />
        </IconButton>
      </header>

      {/* 用真正的 <table>：語意正確，也不需要手動補 grid/row/gridcell 這些 role */}
      <table {...slot('grid', styles.grid)}>
        <caption {...slot('caption', styles.caption)}>{monthLabel(month, locale)}</caption>
        <thead>
          <tr {...slot('weekdays')}>
            {weekdayLabels(locale).map((label, index) => (
              <th scope="col" key={`${label}-${index}`} {...slot('weekday', styles.weekday)}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((week) => (
            <tr {...slot('week')} key={week[0]?.format(DATE_FORMAT)}>
              {week.map((day) => {
                const value = formatDate(day);
                const isSelected = selected.some((item) => item === value);
                const disabled = isOutOfRange(day, min ?? null, max ?? null);
                const outside = !day.isSame(month, 'month');
                return (
                  <td key={value} {...slot('cell', styles.cell)}>
                    <button
                      type="button"
                      {...slot('day', styles.day, { testId: 'calendar-day' })}
                      data-outside={outside || undefined}
                      data-selected={isSelected || undefined}
                      data-in-range={isBetween(day, rangeStart, rangeEnd) || undefined}
                      data-today={day.isSame(dayjs(), 'day') || undefined}
                      aria-pressed={isSelected}
                      aria-label={value}
                      /*
                       * 超出 min/max 的日子用 `aria-disabled` 而非原生 `disabled`：
                       * roving tabindex 會把焦點移到這裡，而原生 disabled 的按鈕
                       * `.focus()` 是 no-op，焦點環會卡住不動（WAI-ARIA grid 的慣例
                       * 也是讓停用的格子保持可聚焦）。點擊改由 onClick 自行擋掉。
                       */
                      aria-disabled={disabled || undefined}
                      data-disabled={disabled ? '' : undefined}
                      tabIndex={day.isSame(focused, 'day') ? 0 : -1}
                      onKeyDown={onKeyDown}
                      onClick={() => {
                        if (disabled) return;
                        setFocused(day);
                        onSelect(value);
                      }}
                      data-value={value}
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
