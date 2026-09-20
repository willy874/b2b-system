import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DateRangePicker } from './index';

describe('DateRangePicker', () => {
  it('第一次點選設定起點', async () => {
    const onValueChange = vi.fn();
    render(
      <DateRangePicker
        value={{ from: null, to: null }}
        onValueChange={onValueChange}
        defaultMonth="2026-09-01"
        aria-label="期間"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '期間' }));
    await userEvent.click(await screen.findByTestId('calendar-day-2026-09-10'));
    expect(onValueChange).toHaveBeenCalledWith({ from: '2026-09-10', to: null });
  });

  it('第二次點選設定終點', async () => {
    const onValueChange = vi.fn();
    render(
      <DateRangePicker
        value={{ from: '2026-09-10', to: null }}
        onValueChange={onValueChange}
        aria-label="期間"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '期間' }));
    await userEvent.click(await screen.findByTestId('calendar-day-2026-09-20'));
    expect(onValueChange).toHaveBeenCalledWith({ from: '2026-09-10', to: '2026-09-20' });
  });

  it('點到早於起點的日期時重設起點', async () => {
    const onValueChange = vi.fn();
    render(
      <DateRangePicker
        value={{ from: '2026-09-20', to: null }}
        onValueChange={onValueChange}
        aria-label="期間"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '期間' }));
    await userEvent.click(await screen.findByTestId('calendar-day-2026-09-10'));
    expect(onValueChange).toHaveBeenCalledWith({ from: '2026-09-10', to: null });
  });

  it('顯示已選範圍，清除鈕一次清掉兩端', async () => {
    const onValueChange = vi.fn();
    render(
      <DateRangePicker
        value={{ from: '2026-09-10', to: '2026-09-20' }}
        onValueChange={onValueChange}
        aria-label="期間"
      />,
    );
    expect(screen.getByRole('button', { name: '期間' })).toHaveTextContent(
      '2026-09-10 ~ 2026-09-20',
    );
    await userEvent.click(screen.getByTestId('date-range-picker-clear'));
    expect(onValueChange).toHaveBeenCalledWith({ from: null, to: null });
  });
});
