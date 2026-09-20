import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../Button';
import { Menu } from './index';

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
    await userEvent.click(await screen.findByTestId('menu-item-edit'));
    expect(onEdit).toHaveBeenCalled();
  });

  it('disabled 的項目不會觸發', async () => {
    const { onDelete } = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    await userEvent.click(await screen.findByTestId('menu-item-delete'));
    expect(onDelete).not.toHaveBeenCalled();
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
