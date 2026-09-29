import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../Button';
import { Tooltip, TooltipProvider } from './index';

function renderTooltip(content = '系統角色不可刪除') {
  return render(
    <TooltipProvider>
      <Tooltip content={content}>
        <Button>刪除</Button>
      </Tooltip>
    </TooltipProvider>,
  );
}

function renderDisabled(onClick = vi.fn()) {
  render(
    <TooltipProvider>
      <Tooltip content="不能刪除自己的帳號">
        <Button disabled onClick={onClick}>
          刪除
        </Button>
      </Tooltip>
    </TooltipProvider>,
  );
  return screen.getByRole('button', { name: '刪除' });
}

describe('Tooltip', () => {
  it('hover 後顯示說明', async () => {
    renderTooltip();
    await userEvent.hover(screen.getByRole('button', { name: '刪除' }));
    expect(await screen.findByText('系統角色不可刪除')).toBeVisible();
  });

  it('鍵盤聚焦也會顯示（不只滑鼠）', async () => {
    renderTooltip();
    await userEvent.tab();
    expect(await screen.findByText('系統角色不可刪除')).toBeVisible();
  });

  it('停用的按鈕改用 aria-disabled，hover 按鈕本身就顯示說明', async () => {
    const button = renderDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('disabled');
    await userEvent.hover(button);
    expect(await screen.findByText('不能刪除自己的帳號')).toBeVisible();
  });

  it('停用的按鈕仍可用鍵盤聚焦看到說明', async () => {
    const button = renderDisabled();
    await userEvent.tab();
    expect(button).toHaveFocus();
    expect(await screen.findByText('不能刪除自己的帳號')).toBeVisible();
  });

  it('停用的按鈕點擊、Enter 都不會觸發 onClick', async () => {
    const onClick = vi.fn();
    const button = renderDisabled(onClick);
    await userEvent.click(button);
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('content 為空時直接渲染 children，不包一層', () => {
    renderTooltip('');
    expect(screen.getByRole('button', { name: '刪除' })).toBeInTheDocument();
  });
});
