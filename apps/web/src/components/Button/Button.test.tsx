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

  it('loading 時 disabled 且標記 aria-busy', () => {
    render(<Button loading>送出</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('透傳 className 與 data-testid', () => {
    render(
      <Button className="custom" data-testid="my-button">
        送出
      </Button>,
    );
    const button = screen.getByTestId('my-button');
    expect(button).toHaveClass('custom');
  });

  it('變體、尺寸與 block 以 data-* 屬性表達', () => {
    render(
      <Button variant="danger" size="sm" block>
        送出
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('data-variant', 'danger');
    expect(button).toHaveAttribute('data-size', 'sm');
    expect(button).toHaveAttribute('data-block');
  });

  it.each(['primary', 'secondary', 'ghost', 'success', 'warning', 'danger'] as const)(
    '變體 %s 寫在 data-variant',
    (variant) => {
      render(<Button variant={variant}>送出</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('data-variant', variant);
    },
  );

  it('IconButton 要求 aria-label 以提供無障礙名稱', () => {
    render(<IconButton aria-label="關閉">✕</IconButton>);
    expect(screen.getByRole('button', { name: '關閉' })).toBeInTheDocument();
  });
});
