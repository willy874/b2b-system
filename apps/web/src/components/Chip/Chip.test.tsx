import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Chip } from './index';

describe('Chip', () => {
  it('渲染內容', () => {
    render(<Chip data-testid="chip">系統角色</Chip>);
    expect(screen.getByTestId('chip')).toHaveTextContent('系統角色');
  });

  it('tone 以 class 表現，不寫死顏色', () => {
    render(
      <Chip tone="danger" data-testid="chip">
        鎖定
      </Chip>,
    );
    expect(screen.getByTestId('chip')).toHaveClass('ge-chip--danger');
  });

  it('預設是 neutral', () => {
    render(<Chip data-testid="chip">一般</Chip>);
    expect(screen.getByTestId('chip')).toHaveClass('ge-chip--neutral');
  });
});
