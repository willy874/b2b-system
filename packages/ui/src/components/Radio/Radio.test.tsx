import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RadioGroup } from './index';

/** 以固定的 `data-testid` ＋ `data-value` 找元素（docs/conventions/06-literal-strings.md §3.3）。 */
function queryOption(value: string) {
  return document.querySelector<HTMLElement>(`[data-testid="radio-option"][data-value="${value}"]`);
}

function getOption(value: string) {
  const element = queryOption(value);
  if (!element) throw new Error(`找不到 radio-option（data-value="${value}"）`);
  return element;
}

const options = [
  { value: 'active', label: '啟用' },
  { value: 'inactive', label: '停用' },
  { value: 'locked', label: '鎖定', disabled: true },
];

describe('RadioGroup', () => {
  it('點擊選項會變更值', async () => {
    const onValueChange = vi.fn();
    render(<RadioGroup options={options} onValueChange={onValueChange} aria-label="狀態" />);
    await userEvent.click(screen.getByText('停用'));
    expect(onValueChange).toHaveBeenCalledWith('inactive');
  });

  it('方向鍵可在選項之間移動（roving tabindex）', async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup
        options={options}
        defaultValue="active"
        onValueChange={onValueChange}
        aria-label="狀態"
      />,
    );
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    expect(onValueChange).toHaveBeenCalledWith('inactive');
  });

  it('disabled 的選項不能選', async () => {
    const onValueChange = vi.fn();
    render(<RadioGroup options={options} onValueChange={onValueChange} aria-label="狀態" />);
    await userEvent.click(getOption('locked'));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('整組 disabled 時完全不能操作', async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup disabled options={options} onValueChange={onValueChange} aria-label="狀態" />,
    );
    await userEvent.click(screen.getByText('啟用'));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('受控值反映在 aria-checked 上', () => {
    render(<RadioGroup value="inactive" options={options} aria-label="狀態" />);
    expect(getOption('inactive')).toHaveAttribute('aria-checked', 'true');
    expect(getOption('active')).toHaveAttribute('aria-checked', 'false');
  });

  it('方向與 disabled 選項以 data-* 屬性表現', () => {
    render(
      <RadioGroup
        options={options}
        orientation="horizontal"
        aria-label="狀態"
        data-testid="group"
        testIds={{ option: 'option' }}
      />,
    );
    expect(screen.getByTestId('group')).toHaveAttribute('data-orientation', 'horizontal');
    const [active, , locked] = screen.getAllByTestId('option');
    expect(active).not.toHaveAttribute('data-disabled');
    expect(locked).toHaveAttribute('data-disabled');
  });
});
