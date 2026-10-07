import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Field } from '../Field';
import { ComponentLabelsContext, DEFAULT_COMPONENT_LABELS } from '../labels';
import { DatePicker } from './index';

/** 以固定的 `data-testid` ＋ `data-value` 找元素（docs/coding-standards/06-literal-strings.md §3.3）。 */
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

  it('invalid 與空值以 data-* 屬性表達', () => {
    render(<DatePicker value={null} invalid onValueChange={vi.fn()} aria-label="開始日期" />);
    const trigger = screen.getByRole('button', { name: '開始日期' });
    expect(trigger).toHaveAttribute('data-invalid');
    expect(screen.getByText('YYYY-MM-DD')).toHaveAttribute('data-empty');
  });

  it('已選日期以 data-selected 標記', async () => {
    render(<DatePicker value="2026-09-15" onValueChange={vi.fn()} aria-label="開始日期" />);
    await userEvent.click(screen.getByRole('button', { name: '開始日期' }));
    expect(await findDay('2026-09-15')).toHaveAttribute('data-selected');
    expect(getDay('2026-09-16')).not.toHaveAttribute('data-selected');
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

  it('超出 min / max 的日期以 aria-disabled 停用，點了不會選取', async () => {
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
    const outOfRange = await findDay('2026-09-25');
    expect(outOfRange).toHaveAttribute('aria-disabled', 'true');
    expect(getDay('2026-09-18')).not.toHaveAttribute('aria-disabled');

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
    (await findDay('2026-09-20')).focus();

    // 21 號超出 max：若用原生 disabled，.focus() 會是 no-op，焦點環會卡在 20 號
    await userEvent.keyboard('{ArrowRight}');

    expect(getDay('2026-09-21')).toHaveFocus();
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

describe('DatePicker 的預設文案與語系（ComponentLabelsContext）', () => {
  it('沒有傳 locale 時日曆跟著 context 的語系', async () => {
    render(
      <ComponentLabelsContext value={{ ...DEFAULT_COMPONENT_LABELS, locale: 'en-US' }}>
        <DatePicker value="2026-10-07" onValueChange={vi.fn()} aria-label="date" />
      </ComponentLabelsContext>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'date' }));
    expect(await screen.findByTestId('date-picker-calendar')).toHaveTextContent('October 2026');
  });

  it('沒有傳 labels 時清除鈕與切換月份的按鈕用 context 的文案', async () => {
    render(
      <ComponentLabelsContext
        value={{
          ...DEFAULT_COMPONENT_LABELS,
          datePickerClear: 'Clear',
          calendarPreviousMonth: 'Previous month',
        }}
      >
        <DatePicker value="2026-10-07" onValueChange={vi.fn()} aria-label="date" />
      </ComponentLabelsContext>,
    );
    expect(screen.getByTestId('date-picker-clear')).toHaveAccessibleName('Clear');
    await userEvent.click(screen.getByRole('button', { name: 'date' }));
    expect(await screen.findByRole('button', { name: 'Previous month' })).toBeInTheDocument();
  });

  it('預設（繁中）文案：清除鈕念「清除」', () => {
    render(<DatePicker value="2026-10-07" onValueChange={vi.fn()} aria-label="date" />);
    expect(screen.getByTestId('date-picker-clear')).toHaveAccessibleName('清除');
  });
});

describe('DatePicker 放在 Field 裡（docs/architecture/frontend/07-ui-system.md §5）', () => {
  it('沒有 aria-label 時名稱是 Field 的標籤加上目前的值', () => {
    render(
      <Field label="到期日">
        <DatePicker value="2026-10-07" onValueChange={vi.fn()} />
      </Field>,
    );
    expect(screen.getByRole('button', { name: '到期日 2026-10-07' })).toBeInTheDocument();
  });

  it('Field 的錯誤以 aria-describedby 連到觸發鈕（button 不支援 aria-invalid，外觀用 data-invalid）', () => {
    render(
      <Field label="到期日" error="到期日不能早於今天">
        <DatePicker value="2026-10-07" onValueChange={vi.fn()} />
      </Field>,
    );
    const trigger = screen.getByRole('button', { name: '到期日 2026-10-07' });
    expect(trigger).toHaveAccessibleDescription('到期日不能早於今天');
    expect(trigger).toHaveAttribute('data-invalid');
  });

  it('點 Field 的標籤會聚焦到觸發鈕（不打開日曆）', async () => {
    render(
      <Field label="到期日">
        <DatePicker value="2026-10-07" onValueChange={vi.fn()} />
      </Field>,
    );
    await userEvent.click(screen.getByText('到期日'));
    expect(screen.getByRole('button', { name: '到期日 2026-10-07' })).toHaveFocus();
    expect(screen.queryByTestId('date-picker-calendar')).not.toBeInTheDocument();
  });
});
