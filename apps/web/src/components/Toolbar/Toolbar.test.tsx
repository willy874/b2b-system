import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../Button';
import { Toolbar, ToolbarButton, ToolbarSeparator } from './index';

function renderToolbar(onDelete = vi.fn()) {
  render(
    <Toolbar aria-label="角色操作">
      <ToolbarButton render={<Button />}>建立</ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton render={<Button />} disabled onClick={onDelete}>
        刪除
      </ToolbarButton>
    </Toolbar>,
  );
  return onDelete;
}

describe('Toolbar', () => {
  it('以 toolbar 角色曝露', () => {
    renderToolbar();
    expect(screen.getByRole('toolbar', { name: '角色操作' })).toBeInTheDocument();
  });

  it('roving tabindex：整條只佔一個 Tab 停留點，方向鍵在內部移動', async () => {
    renderToolbar();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: '建立' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: '建立' })).not.toHaveFocus();
  });

  it('方向用 data-orientation 表達，分隔線與 toolbar 垂直', () => {
    render(
      <Toolbar orientation="vertical" data-testid="toolbar">
        <ToolbarButton>建立</ToolbarButton>
        <ToolbarSeparator />
      </Toolbar>,
    );
    expect(screen.getByTestId('toolbar')).toHaveAttribute('data-orientation', 'vertical');
    expect(screen.getByRole('separator')).toHaveAttribute('data-orientation', 'horizontal');
  });

  it('disabled 的按鈕不會觸發', async () => {
    const onDelete = renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: '刪除' }));
    expect(onDelete).not.toHaveBeenCalled();
  });
});
