import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Calendar } from './index';

function day(value: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-testid="calendar-day"][data-value="${value}"]`,
  );
  if (!element) throw new Error(`找不到 calendar-day（data-value="${value}"）`);
  return element;
}

const monthTitle = () => screen.getByRole('table').querySelector('caption')?.textContent;

function renderCalendar(props: Partial<Parameters<typeof Calendar>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <Calendar
      selected={['2026-09-15']}
      onSelect={onSelect}
      locale="en-US"
      labels={{ previousMonth: '上個月', nextMonth: '下個月' }}
      {...props}
    />,
  );
  return { onSelect };
}

/** 可以用 Tab 進入的那一天（roving tabindex）。 */
const tabStop = () =>
  document.querySelector<HTMLElement>('[data-testid="calendar-day"][tabindex="0"]')?.dataset.value;

/** 從可以 Tab 進入的那一天開始按鍵；回傳之後的 tab stop。 */
async function press(keys: string) {
  document.querySelector<HTMLElement>('[data-testid="calendar-day"][tabindex="0"]')?.focus();
  await userEvent.keyboard(keys);
  return tabStop();
}

describe('Calendar（月曆網格的鍵盤操作）', () => {
  it('↑／↓ 移動一週，焦點跟著移動', async () => {
    renderCalendar();
    expect(await press('{ArrowDown}')).toBe('2026-09-22');
    expect(document.activeElement).toBe(day('2026-09-22'));
    expect(await press('{ArrowUp}{ArrowUp}')).toBe('2026-09-08');
  });

  it('Home／End 跳到當月第一天與最後一天', async () => {
    renderCalendar();
    expect(await press('{Home}')).toBe('2026-09-01');
    expect(await press('{End}')).toBe('2026-09-30');
  });

  it('PageDown／PageUp 換月，顯示的月份跟著換', async () => {
    renderCalendar();
    expect(await press('{PageDown}')).toBe('2026-10-15');
    expect(monthTitle()).toContain('October');
    expect(await press('{PageUp}')).toBe('2026-09-15');
    expect(await press('{PageUp}')).toBe('2026-08-15');
    expect(monthTitle()).toContain('August');
  });

  it('方向鍵走出當月時換到那個月', async () => {
    renderCalendar();
    await press('{End}');
    expect(await press('{ArrowRight}')).toBe('2026-10-01');
    expect(monthTitle()).toContain('October');
  });

  it('空白鍵也能選取', async () => {
    const { onSelect } = renderCalendar();
    await press('{ArrowLeft} ');
    expect(onSelect).toHaveBeenCalledWith('2026-09-14');
  });

  it('超出範圍的日期按 Enter 不選取', async () => {
    const { onSelect } = renderCalendar({ max: '2026-09-15' });
    await press('{ArrowRight}{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('其他按鍵不移動焦點', async () => {
    renderCalendar();
    expect(await press('a')).toBe('2026-09-15');
  });
});

describe('Calendar（顯示）', () => {
  it('上／下個月的按鈕切換顯示的月份', () => {
    renderCalendar({ testIds: { previousButton: 'previous', nextButton: 'next' } });
    expect(screen.getByTestId('next')).toHaveAccessibleName('下個月');
    expect(screen.getByTestId('previous')).toHaveAccessibleName('上個月');
    fireEvent.click(screen.getByTestId('next'));
    expect(monthTitle()).toContain('October');
    fireEvent.click(screen.getByTestId('previous'));
    fireEvent.click(screen.getByTestId('previous'));
    expect(monthTitle()).toContain('August');
  });

  it('沒有選取值時顯示 defaultMonth', () => {
    renderCalendar({ selected: [], defaultMonth: '2027-02-10' });
    expect(monthTitle()).toContain('February 2027');
    expect(day('2027-02-10')).toHaveAttribute('tabindex', '0');
  });

  it('範圍的中間區段以 data-in-range 標記；當月以外的日子標 data-outside', () => {
    renderCalendar({
      selected: ['2026-09-10', '2026-09-13'],
      range: { start: '2026-09-10', end: '2026-09-13' },
    });
    expect(day('2026-09-11')).toHaveAttribute('data-in-range');
    expect(day('2026-09-12')).toHaveAttribute('data-in-range');
    expect(day('2026-09-14')).not.toHaveAttribute('data-in-range');
    expect(day('2026-09-10')).toHaveAttribute('aria-pressed', 'true');
    expect(day('2026-08-31')).toHaveAttribute('data-outside');
  });

  it('點選日期回傳 YYYY-MM-DD；超出範圍的日期點了不回傳', () => {
    const { onSelect } = renderCalendar({ min: '2026-09-10' });
    fireEvent.click(day('2026-09-09'));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(day('2026-09-20'));
    expect(onSelect).toHaveBeenCalledWith('2026-09-20');
    expect(day('2026-09-20')).toHaveAttribute('tabindex', '0');
  });
});
