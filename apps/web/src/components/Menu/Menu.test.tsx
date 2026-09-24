import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../Button';
import { Menu } from './index';

/** 以固定的 `data-testid` ＋ `data-value` 找元素（docs/conventions/06-literal-strings.md §3.3）。 */
function queryItem(value: string) {
  return document.querySelector<HTMLElement>(`[data-testid="menu-item"][data-value="${value}"]`);
}

function getItem(value: string) {
  const element = queryItem(value);
  if (!element) throw new Error(`找不到 menu-item（data-value="${value}"）`);
  return element;
}

const findItem = (value: string) => waitFor(() => getItem(value));

function renderMenu(onEdit = vi.fn(), onDelete = vi.fn()) {
  render(
    <Menu
      trigger={<Button>操作</Button>}
      items={[
        { key: 'edit', label: '編輯', onSelect: onEdit },
        { key: 'delete', label: '刪除', tone: 'danger', onSelect: onDelete, disabled: true },
      ]}
    />,
  );
  return { onEdit, onDelete };
}

describe('Menu', () => {
  it('點擊觸發鈕後開啟選單', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('選取項目會觸發 onSelect', async () => {
    const { onEdit } = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    await userEvent.click(await findItem('edit'));
    expect(onEdit).toHaveBeenCalled();
  });

  it('disabled 的項目不會觸發', async () => {
    const { onDelete } = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    await userEvent.click(await findItem('delete'));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('tone 以 data-tone 屬性表現', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    expect(await findItem('delete')).toHaveAttribute('data-tone', 'danger');
    expect(getItem('edit')).toHaveAttribute('data-tone', 'default');
  });

  it('鍵盤可開啟，Esc 關閉後焦點回到觸發鈕', async () => {
    renderMenu();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '操作' })).toHaveFocus();
  });

  it('Esc 關閉選單', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    await screen.findByRole('menu');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
