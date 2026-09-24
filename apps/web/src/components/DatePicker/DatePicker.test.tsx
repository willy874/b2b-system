import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DatePicker } from './index';

/** 以固定的 `data-testid` ＋ `data-value` 找元素（docs/conventions/06-literal-strings.md §3.3）。 */
function queryDay(value: string) {
  return document.querySelector<HTMLElement>(`[data-testid="calendar-day"][data-value="${value}"]`);
}

function getDay(value: string) {
  const element = queryDay(value);
  if (!element) throw new Error(`找不到 calendar-day（data-value="${value}"）`);
  return element;
}

const findDay = (value: string) => waitFor(() => getDay(value));

describe('DatePicker', () => {
  it('沒有值時顯示 placeholder', () => {
    render(<DatePicker value={null} onValueChange={vi.fn()} aria-label="開始日期" />);
    expect(screen.getByRole('button', { name: '開始日期' })).toHaveTextContent('YYYY-MM-DD');
  });

  it('點擊日期會回傳 YYYY-MM-DD 並關閉彈層', async () => {
    const onValueChange = vi.fn();
    render(<DatePicker value="2026-09-15" onValueChange={onValueChange} aria-label="開始日期" />);

    await userEvent.click(screen.getByRole('button', { name: '開始日期' }));
    await userEvent.click(await findDay('2026-09-20'));

    expect(onValueChange).toHaveBeenCalledWith('2026-09-20');
  });

  it('鍵盤：方向鍵移動、Enter 選取', async () => {
    const onValueChange = vi.fn();
    render(<DatePicker value="2026-09-15" onValueChange={onValueChange} aria-label="開始日期" />);

    await userEvent.click(screen.getByRole('button', { name: '開始日期' }));
    const selected = await findDay('2026-09-15');
    selected.focus();
    await userEvent.keyboard('{ArrowRight}{Enter}');

    expect(onValueChange).toHaveBeenCalledWith('2026-09-16');
  });

  it('超出 min / max 的日期是 disabled', async () => {
    render(
      <DatePicker
        value="2026-09-15"
        min="2026-09-10"
        max="2026-09-20"
        onValueChange={vi.fn()}
        aria-label="開始日期"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '開始日期' }));
    expect(await findDay('2026-09-25')).toBeDisabled();
    expect(getDay('2026-09-18')).toBeEnabled();
  });

  it('清除按鈕把值設回 null', async () => {
    const onValueChange = vi.fn();
    render(<DatePicker value="2026-09-15" onValueChange={onValueChange} aria-label="開始日期" />);
    await userEvent.click(screen.getByTestId('date-picker-clear'));
    expect(onValueChange).toHaveBeenCalledWith(null);
  });

  it('disabled 時不能開啟，也沒有清除鈕', async () => {
    render(
      <DatePicker value="2026-09-15" disabled onValueChange={vi.fn()} aria-label="開始日期" />,
    );
    await userEvent.click(screen.getByRole('button', { name: '開始日期' }));
    expect(screen.queryByTestId('date-picker-calendar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('date-picker-clear')).not.toBeInTheDocument();
  });
});
