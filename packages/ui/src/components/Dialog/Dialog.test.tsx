import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from './index';

describe('Dialog', () => {
  it('open 時渲染標題與內容', () => {
    render(
      <Dialog open title="建立角色" description="說明">
        <p>內容</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('建立角色')).toBeInTheDocument();
    expect(screen.getByText('內容')).toBeInTheDocument();
  });

  it('Esc 會關閉（dismissible 預設為 true）', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="建立角色">
        <p>內容</p>
      </Dialog>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalled();
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
  });

  it('dismissible={false}：按 Esc 不呼叫 onOpenChange(false)（docs/architecture/frontend/07-ui-system.md §3.2）', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} dismissible={false} title="簽章密鑰">
        <p>只會顯示這一次</p>
      </Dialog>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('dismissible={false}：點遮罩不關閉', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        dismissible={false}
        title="簽章密鑰"
        testIds={{ backdrop: 'dialog-backdrop' }}
      >
        <p>只會顯示這一次</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('dismissible={false} 而且非受控：按 Esc 仍然開著', async () => {
    render(
      <Dialog defaultOpen dismissible={false} title="簽章密鑰">
        <p>只會顯示這一次</p>
      </Dialog>,
    );
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('點遮罩會關閉（dismissible 預設為 true）', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="建立角色"
        testIds={{ backdrop: 'dialog-backdrop' }}
      >
        <p>內容</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('尺寸以 data-size 屬性表達', () => {
    render(
      <Dialog open size="lg" title="建立角色">
        <p>內容</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('data-size', 'lg');
  });

  it('關閉時不渲染任何東西', () => {
    render(
      <Dialog open={false} title="建立角色">
        <p>內容</p>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
