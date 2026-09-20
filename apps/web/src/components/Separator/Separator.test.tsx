import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Separator } from './index';

describe('Separator', () => {
  it('預設是水平分隔線', () => {
    render(<Separator data-testid="separator" />);
    expect(screen.getByTestId('separator')).toHaveClass('ge-separator--horizontal');
  });

  it('可切換成垂直', () => {
    render(<Separator orientation="vertical" data-testid="separator" />);
    expect(screen.getByTestId('separator')).toHaveClass('ge-separator--vertical');
  });

  it('對輔助技術是裝飾性的（不干擾閱讀順序）', () => {
    render(<Separator data-testid="separator" />);
    expect(screen.getByTestId('separator')).toHaveAttribute('role', 'separator');
  });
});
