import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button, IconButton } from './index';

describe('Button', () => {
  it('點擊會觸發 onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>送出</Button>);
    await userEvent.click(screen.getByRole('button', { name: '送出' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('鍵盤 Enter / Space 可以觸發', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>送出</Button>);
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('disabled 時不觸發也不可聚焦', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        送出
      </Button>,
    );
    const button = screen.getByRole('button', { name: '送出' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading 時阻擋點擊並標記 aria-busy，但仍可聚焦', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        送出
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('data-disabled');

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('送出後進入 loading 不會讓焦點掉回 body', () => {
    const { rerender } = render(<Button>送出</Button>);
    screen.getByRole('button').focus();

    rerender(<Button loading>送出</Button>);

    expect(screen.getByRole('button')).toHaveFocus();
  });

  it('透傳 className 與 data-testid', () => {
    render(
      <Button className="custom" data-testid="my-button">
        送出
      </Button>,
    );
    const button = screen.getByTestId('my-button');
    expect(button).toHaveClass('custom');
    expect(button).toHaveClass('ge-button');
  });

  it('focusableWhenDisabled 讓停用的按鈕仍可聚焦（外層 Tooltip 才讀得到理由）', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled focusableWhenDisabled onClick={onClick}>
        刪除
      </Button>,
    );
    const button = screen.getByRole('button', { name: '刪除' });

    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.tab();
    expect(button).toHaveFocus();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('IconButton 要求 aria-label 以提供無障礙名稱', () => {
    render(<IconButton aria-label="關閉">✕</IconButton>);
    expect(screen.getByRole('button', { name: '關閉' })).toBeInTheDocument();
  });
});
