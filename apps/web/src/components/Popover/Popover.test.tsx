import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button } from '../Button';
import { Popover } from './index';

function renderPopover() {
  return render(
    <Popover trigger={<Button>更多</Button>} title="篩選">
      <p>內容</p>
    </Popover>,
  );
}

describe('Popover', () => {
  it('點擊觸發元素後開啟', async () => {
    renderPopover();
    expect(screen.queryByText('內容')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(await screen.findByText('內容')).toBeVisible();
  });

  it('Esc 會關閉', async () => {
    renderPopover();
    await userEvent.click(screen.getByRole('button', { name: '更多' }));
    await screen.findByText('內容');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('內容')).not.toBeInTheDocument();
  });

  it('鍵盤 Enter 可開啟', async () => {
    renderPopover();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('內容')).toBeVisible();
  });

  it('disabled 的觸發元素不會開啟', async () => {
    render(
      <Popover trigger={<Button disabled>更多</Button>}>
        <p>內容</p>
      </Popover>,
    );
    await userEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.queryByText('內容')).not.toBeInTheDocument();
  });
});
