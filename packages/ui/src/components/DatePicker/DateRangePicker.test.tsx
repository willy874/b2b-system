import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Field } from '../Field';
import { DateRangePicker } from './index';

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
    await userEvent.click(await findDay('2026-09-10'));
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
    await userEvent.click(await findDay('2026-09-20'));
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
    await userEvent.click(await findDay('2026-09-10'));
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

  it('maxSpanDays：選了起點後，超過跨度的日期不可選', async () => {
    render(
      <DateRangePicker
        value={{ from: '2026-09-10', to: null }}
        onValueChange={vi.fn()}
        maxSpanDays={7}
        aria-label="期間"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '期間' }));
    expect(await findDay('2026-09-16')).not.toHaveAttribute('aria-disabled');
    expect(getDay('2026-09-17')).toHaveAttribute('aria-disabled', 'true');
  });

  it('maxSpanDays 與 max 取較早者', async () => {
    render(
      <DateRangePicker
        value={{ from: '2026-09-10', to: null }}
        onValueChange={vi.fn()}
        max="2026-09-12"
        maxSpanDays={7}
        aria-label="期間"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '期間' }));
    expect(await findDay('2026-09-12')).not.toHaveAttribute('aria-disabled');
    expect(getDay('2026-09-13')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('DateRangePicker 放在 Field 裡（docs/architecture/frontend/07-ui-system.md §5）', () => {
  it('沒有 aria-label 時名稱是 Field 的標籤加上目前的值，錯誤連到 aria-describedby', () => {
    render(
      <Field label="期間" error="請選擇期間">
        <DateRangePicker value={{ from: null, to: null }} onValueChange={vi.fn()} />
      </Field>,
    );
    const trigger = screen.getByRole('button', { name: /^期間/ });
    expect(trigger).toHaveAccessibleDescription('請選擇期間');
    expect(trigger).toHaveAttribute('data-invalid');
  });
});
