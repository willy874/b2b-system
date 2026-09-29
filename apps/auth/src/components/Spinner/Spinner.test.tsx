import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Spinner } from './index';

describe('Spinner', () => {
  it('以 status 角色曝露載入狀態', () => {
    render(<Spinner />);
    expect(screen.getByRole('status', { name: 'loading' })).toBeInTheDocument();
  });

  it('可自訂標籤與尺寸', () => {
    render(<Spinner label="載入角色中" size={32} data-testid="spinner" />);
    const spinner = screen.getByTestId('spinner');
    expect(spinner).toHaveAccessibleName('載入角色中');
    expect(spinner).toHaveStyle({ width: '32px' });
  });
});
