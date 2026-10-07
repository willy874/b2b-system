import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Accordion } from './index';

/** 以固定的 `data-testid` ＋ `data-value` 找元素（docs/coding-standards/06-literal-strings.md §3.3）。 */
function queryTrigger(value: string) {
  return document.querySelector<HTMLElement>(
    `[data-testid="accordion-trigger"][data-value="${value}"]`,
  );
}

function getTrigger(value: string) {
  const element = queryTrigger(value);
  if (!element) throw new Error(`找不到 accordion-trigger（data-value="${value}"）`);
  return element;
}

const items = [
  { value: 'user', title: '使用者', content: '使用者相關權限' },
  { value: 'role', title: '角色', content: '角色相關權限' },
  { value: 'system', title: '系統', content: '系統設定', disabled: true },
];

describe('Accordion', () => {
  it('點擊標題展開對應內容', async () => {
    render(<Accordion items={items} />);
    expect(screen.queryByText('使用者相關權限')).not.toBeInTheDocument();
    await userEvent.click(getTrigger('user'));
    expect(await screen.findByText('使用者相關權限')).toBeVisible();
  });

  it('single 模式下展開新項目會收合舊的', async () => {
    const onValueChange = vi.fn();
    render(<Accordion single items={items} onValueChange={onValueChange} />);
    await userEvent.click(getTrigger('user'));
    await userEvent.click(getTrigger('role'));
    expect(onValueChange).toHaveBeenLastCalledWith(['role']);
  });

  // Base UI 1.6 起依 APG 拿掉方向鍵的 roving focus：每個標題都在 Tab 順序裡，方向鍵不移動焦點
  it('Tab 在標題之間移動', async () => {
    render(<Accordion items={items} />);
    await userEvent.tab();
    expect(getTrigger('user')).toHaveFocus();
    await userEvent.tab();
    expect(getTrigger('role')).toHaveFocus();
  });

  it('disabled 的項目不能展開', async () => {
    const onValueChange = vi.fn();
    render(<Accordion items={items} onValueChange={onValueChange} />);
    await userEvent.click(getTrigger('system'));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
