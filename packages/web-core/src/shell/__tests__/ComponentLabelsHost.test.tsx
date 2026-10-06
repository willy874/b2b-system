import { Button } from '@b2b-system/ui/Button';
import { DatePicker } from '@b2b-system/ui/DatePicker';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { i18n, initI18n } from '../../locales';
import enUS from '../../locales/resources/en_US.json';
import zhTW from '../../locales/resources/zh_TW.json';
import { ComponentLabelsHost } from '../ComponentLabelsHost';

function Fixture() {
  return (
    <ComponentLabelsHost>
      <DatePicker value="2026-10-07" onValueChange={vi.fn()} aria-label="date" />
      <Button loading>Save</Button>
    </ComponentLabelsHost>
  );
}

describe('ComponentLabelsHost（設計系統元件的預設文案跟著語系）', () => {
  beforeAll(async () => {
    await initI18n('zh-TW');
    i18n.addResourceBundle('zh-TW', 'translation', zhTW, true, true);
    i18n.addResourceBundle('en-US', 'translation', enUS, true, true);
  });

  afterEach(async () => {
    await act(() => i18n.changeLanguage('zh-TW'));
  });

  it('切成 en-US 之後，日曆的月份標題與星期是英文，切換月份的按鈕也是英文', async () => {
    render(<Fixture />);
    await act(() => i18n.changeLanguage('en-US'));

    await userEvent.click(screen.getByRole('button', { name: 'date' }));
    const calendar = await screen.findByTestId('date-picker-calendar');
    expect(calendar).toHaveTextContent('October 2026');
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'S',
      'M',
      'T',
      'W',
      'T',
      'F',
      'S',
    ]);
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
  });

  it('切成 en-US 之後，日期選擇器的清除鈕名稱是 Clear', async () => {
    render(<Fixture />);
    await act(() => i18n.changeLanguage('en-US'));
    expect(screen.getByTestId('date-picker-clear')).toHaveAccessibleName('Clear');
  });

  it('載入中按鈕的名稱用目前語系的「載入中」，不是英文的 loading', async () => {
    render(<Fixture />);
    const button = screen.getByRole('button', { name: /Save/ });
    expect(button).toHaveAccessibleName(/^載入中…\s*Save$/);
    await act(() => i18n.changeLanguage('en-US'));
    await waitFor(() => expect(button).toHaveAccessibleName(/^Loading…\s*Save$/));
    expect(button).not.toHaveAccessibleName(/loading\b/);
  });
});
