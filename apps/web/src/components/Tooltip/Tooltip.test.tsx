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

  it('content 為空時直接渲染 children，不包一層', () => {
    renderTooltip('');
    expect(screen.getByRole('button', { name: '刪除' })).toBeInTheDocument();
  });
});
