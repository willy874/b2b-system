import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

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

  it('停用的按鈕：hover 外層觸發點仍顯示說明', async () => {
    render(
      <TooltipProvider>
        <Tooltip content="不能刪除自己的帳號">
          <Button disabled>刪除</Button>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: '刪除' })).toBeDisabled();
    await userEvent.hover(screen.getByTestId('tooltip-disabled-trigger'));
    expect(await screen.findByText('不能刪除自己的帳號')).toBeVisible();
  });

  it('停用的按鈕：鍵盤可以聚焦外層觸發點看到說明', async () => {
    render(
      <TooltipProvider>
        <Tooltip content="不能刪除自己的帳號">
          <Button disabled>刪除</Button>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.tab();
    expect(screen.getByTestId('tooltip-disabled-trigger')).toHaveFocus();
    expect(await screen.findByText('不能刪除自己的帳號')).toBeVisible();
  });

  it('沒有停用時不包外層', () => {
    renderTooltip();
    expect(screen.queryByTestId('tooltip-disabled-trigger')).not.toBeInTheDocument();
  });

  it('content 為空時直接渲染 children，不包一層', () => {
    renderTooltip('');
    expect(screen.getByRole('button', { name: '刪除' })).toBeInTheDocument();
  });
});
