import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './index';

describe('Skeleton', () => {
  it('對輔助技術隱藏（載入中的佔位不該被朗讀）', () => {
    render(<Skeleton data-testid="skeleton" />);
    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true');
  });

  it('套用寬高', () => {
    render(<Skeleton width={120} height={20} data-testid="skeleton" />);
    expect(screen.getByTestId('skeleton')).toHaveStyle({ width: '120px', height: '20px' });
  });

  it('rounded 以 data-rounded 屬性表達', () => {
    render(<Skeleton rounded data-testid="skeleton" />);
    expect(screen.getByTestId('skeleton')).toHaveAttribute('data-rounded');
  });
});
