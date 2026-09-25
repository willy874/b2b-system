import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BatchActionBar } from './BatchActionBar';

describe('BatchActionBar', () => {
  it('是一個工具列，顯示已選筆數與呼叫端的操作按鈕', () => {
    render(
      <BatchActionBar count={3} onClear={vi.fn()}>
        <button type="button">刪除</button>
      </BatchActionBar>,
    );
    expect(screen.getByRole('toolbar', { name: '批次操作' })).toBeInTheDocument();
    expect(screen.getByTestId('batch-action-bar-count')).toHaveTextContent('已選取 3 筆');
    expect(screen.getByTestId('batch-action-bar-count')).toHaveAttribute('data-value', '3');
    expect(screen.getByRole('button', { name: '刪除' })).toBeInTheDocument();
  });

  it('按清除選取呼叫 onClear', async () => {
    const onClear = vi.fn();
    render(<BatchActionBar count={1} onClear={onClear} />);
    await userEvent.click(screen.getByTestId('batch-action-bar-clear'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('文案由 labels 覆寫', () => {
    render(
      <BatchActionBar
        count={2}
        onClear={vi.fn()}
        labels={{ count: (count) => `${count} selected`, clear: 'Clear', toolbar: 'Bulk actions' }}
      />,
    );
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toBeInTheDocument();
    expect(screen.getByTestId('batch-action-bar-count')).toHaveTextContent('2 selected');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('透傳 data-testid、className 與 slot 覆寫', () => {
    render(
      <BatchActionBar
        count={1}
        onClear={vi.fn()}
        className="custom"
        data-testid="user-batch-bar"
        testIds={{ clear: 'user-batch-clear' }}
      />,
    );
    const root = screen.getByTestId('user-batch-bar');
    expect(root).toHaveClass('custom');
    expect(screen.getByTestId('user-batch-clear')).toBeInTheDocument();
  });
});
