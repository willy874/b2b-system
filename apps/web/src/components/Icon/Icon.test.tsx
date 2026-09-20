import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Icon } from './index';

describe('Icon', () => {
  it('純裝飾時對輔助技術隱藏', () => {
    const { container } = render(<Icon name="home" data-testid="home-icon" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('有 aria-label 時以 img 角色曝露', () => {
    render(<Icon name="warning" aria-label="警告" />);
    expect(screen.getByRole('img', { name: '警告' })).toBeInTheDocument();
  });

  it('尺寸與 className 透傳', () => {
    const { container } = render(<Icon name="check" size={24} className="custom" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveClass('custom', 'ge-icon');
  });
});
