import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DatePicker } from './index';

describe('DatePicker', () => {
  it('沒有值時顯示 placeholder', () => {
    render(<DatePicker value={null} onValueChange={vi.fn()} aria-label="開始日期" />);
    expect(screen.getByRole('button', { name: '開始日期' })).toHaveTextContent('YYYY-MM-DD');
  });

  it('點擊日期會回傳 YYYY-MM-DD 並關閉彈層', async () => {
    const onValueChange = vi.fn();
    render(<DatePicker value="2026-09-15" onValueChange={onValueChange} aria-label="開始日期" />);

    await userEvent.click(screen.getByRole('button', { name: '開始日期' }));
    await userEvent.click(await screen.findByTestId('calendar-day-2026-09-20'));

    expect(onValueChange).toHaveBeenCalledWith('2026-09-20');
  });

  it('鍵盤：方向鍵移動、Enter 選取', async () => {
    const onValueChange = vi.fn();
    render(<DatePicker value="2026-09-15" onValueChange={onValueChange} aria-label="開始日期" />);

    await userEvent.click(screen.getByRole('button', { name: '開始日期' }));
    const selected = await screen.findByTestId('calendar-day-2026-09-15');
    selected.focus();
    await userEvent.keyboard('{ArrowRight}{Enter}');

    expect(onValueChange).toHaveBeenCalledWith('2026-09-16');
  });

  it('超出 min / max 的日期標記 aria-disabled 且不可選', async () => {
    const onValueChange = vi.fn();
    render(
      <DatePicker
        value="2026-09-15"
        min="2026-09-10"
        max="2026-09-20"
        onValueChange={onValueChange}
        aria-label="開始日期"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '開始日期' }));

    const outOfRange = await screen.findByTestId('calendar-day-2026-09-25');
    expect(outOfRange).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('calendar-day-2026-09-18')).not.toHaveAttribute('aria-disabled');

    await userEvent.click(outOfRange);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('方向鍵走到超出範圍的日期時，焦點仍然跟著移動', async () => {
    render(
      <DatePicker
        value="2026-09-20"
        min="2026-09-10"
        max="2026-09-20"
        onValueChange={vi.fn()}
        aria-label="開始日期"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '開始日期' }));
    (await screen.findByTestId('calendar-day-2026-09-20')).focus();

    // 21 號超出 max：若用原生 disabled，.focus() 會是 no-op，焦點環會卡在 20 號
    await userEvent.keyboard('{ArrowRight}');

    expect(screen.getByTestId('calendar-day-2026-09-21')).toHaveFocus();
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
