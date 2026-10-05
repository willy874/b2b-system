import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Collapsible } from './index';

describe('Collapsible', () => {
  it('預設收合，點擊後展開', async () => {
    render(<Collapsible title="進階選項">內容</Collapsible>);
    expect(screen.queryByText('內容')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '進階選項' }));
    expect(await screen.findByText('內容')).toBeVisible();
  });

  it('鍵盤 Enter / Space 可切換', async () => {
    const onOpenChange = vi.fn();
    render(
      <Collapsible title="進階選項" onOpenChange={onOpenChange}>
        內容
      </Collapsible>,
    );
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it('disabled 時不能展開', async () => {
    const onOpenChange = vi.fn();
    render(
      <Collapsible title="進階選項" disabled onOpenChange={onOpenChange}>
        內容
      </Collapsible>,
    );
    await userEvent.click(screen.getByRole('button', { name: '進階選項' }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('受控 open 時由外部決定', () => {
    render(
      <Collapsible title="進階選項" open>
        內容
      </Collapsible>,
    );
    expect(screen.getByText('內容')).toBeVisible();
  });
});
