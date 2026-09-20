import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Accordion } from './index';

const items = [
  { value: 'user', title: '使用者', content: '使用者相關權限' },
  { value: 'role', title: '角色', content: '角色相關權限' },
  { value: 'system', title: '系統', content: '系統設定', disabled: true },
];

describe('Accordion', () => {
  it('點擊標題展開對應內容', async () => {
    render(<Accordion items={items} />);
    expect(screen.queryByText('使用者相關權限')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('accordion-trigger-user'));
    expect(await screen.findByText('使用者相關權限')).toBeVisible();
  });

  it('single 模式下展開新項目會收合舊的', async () => {
    const onValueChange = vi.fn();
    render(<Accordion single items={items} onValueChange={onValueChange} />);
    await userEvent.click(screen.getByTestId('accordion-trigger-user'));
    await userEvent.click(screen.getByTestId('accordion-trigger-role'));
    expect(onValueChange).toHaveBeenLastCalledWith(['role']);
  });

  it('方向鍵可在標題之間移動', async () => {
    render(<Accordion items={items} />);
    await userEvent.tab();
    expect(screen.getByTestId('accordion-trigger-user')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByTestId('accordion-trigger-role')).toHaveFocus();
  });

  it('disabled 的項目不能展開', async () => {
    const onValueChange = vi.fn();
    render(<Accordion items={items} onValueChange={onValueChange} />);
    await userEvent.click(screen.getByTestId('accordion-trigger-system'));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
