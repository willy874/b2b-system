import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NumberField } from './index';

describe('NumberField', () => {
  it('點擊加減按鈕會改值', async () => {
    const onValueChange = vi.fn();
    render(<NumberField defaultValue={3} onValueChange={onValueChange} aria-label="數量" />);

    await userEvent.click(screen.getByRole('button', { name: 'increase' }));
    expect(onValueChange).toHaveBeenLastCalledWith(4);

    await userEvent.click(screen.getByRole('button', { name: 'decrease' }));
    expect(onValueChange).toHaveBeenLastCalledWith(3);
  });

  it('鍵盤上下鍵可調整', async () => {
    const onValueChange = vi.fn();
    render(
      <NumberField defaultValue={1} step={2} onValueChange={onValueChange} aria-label="數量" />,
    );
    await userEvent.click(screen.getByRole('textbox', { name: '數量' }));
    await userEvent.keyboard('{ArrowUp}');
    expect(onValueChange).toHaveBeenLastCalledWith(3);
  });

  it('disabled 時按鈕不可用', async () => {
    const onValueChange = vi.fn();
    render(
      <NumberField disabled defaultValue={1} onValueChange={onValueChange} aria-label="數量" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'increase' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('min / max 會夾住數值', async () => {
    const onValueChange = vi.fn();
    render(
      <NumberField defaultValue={5} max={5} onValueChange={onValueChange} aria-label="數量" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'increase' }));
    expect(onValueChange).not.toHaveBeenCalledWith(6);
  });
});
