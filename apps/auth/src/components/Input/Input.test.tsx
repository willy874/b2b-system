import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Input, Textarea } from './index';

describe('Input', () => {
  it('可輸入文字', async () => {
    const onChange = vi.fn();
    render(<Input aria-label="名稱" onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox', { name: '名稱' }), 'abc');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('disabled 時不可輸入', async () => {
    const onChange = vi.fn();
    render(<Input aria-label="名稱" disabled onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: '名稱' });
    expect(input).toBeDisabled();
    await userEvent.type(input, 'abc');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('invalid 反映在 aria-invalid', () => {
    render(<Input aria-label="名稱" invalid />);
    expect(screen.getByRole('textbox', { name: '名稱' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('Tab 可以聚焦', async () => {
    render(<Input aria-label="名稱" />);
    await userEvent.tab();
    expect(screen.getByRole('textbox', { name: '名稱' })).toHaveFocus();
  });

  it('尺寸以 data-size 屬性表達', () => {
    render(<Input aria-label="名稱" size="sm" />);
    expect(screen.getByRole('textbox', { name: '名稱' })).toHaveAttribute('data-size', 'sm');
  });

  it('Textarea 支援多行與 rows', () => {
    render(<Textarea aria-label="描述" rows={5} />);
    expect(screen.getByRole('textbox', { name: '描述' })).toHaveAttribute('rows', '5');
  });
});
