import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Progress } from './index';

describe('Progress', () => {
  it('以 progressbar 角色曝露數值', () => {
    render(<Progress value={40} aria-label="上傳進度" />);
    const bar = screen.getByRole('progressbar', { name: '上傳進度' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('value=null 時是不確定進度（沒有 aria-valuenow）', () => {
    render(<Progress value={null} aria-label="處理中" />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('可顯示標籤與百分比', () => {
    render(<Progress value={65} label="匯入中" showValue />);
    expect(screen.getByText('匯入中')).toBeInTheDocument();
    expect(screen.getByText('65%')).toBeInTheDocument();
  });

  it('tone 以 data-tone 屬性表現', () => {
    render(<Progress value={10} tone="danger" data-testid="progress" aria-label="p" />);
    expect(screen.getByTestId('progress')).toHaveAttribute('data-tone', 'danger');
  });
});
