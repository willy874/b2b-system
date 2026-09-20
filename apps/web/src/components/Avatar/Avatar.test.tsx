import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar } from './index';

describe('Avatar', () => {
  it('沒有圖片時顯示名字縮寫', () => {
    render(<Avatar name="Alice Chen" data-testid="avatar" />);
    expect(screen.getByTestId('avatar')).toHaveTextContent('AC');
  });

  it('單一字詞取前兩個字', () => {
    render(<Avatar name="admin" data-testid="avatar" />);
    expect(screen.getByTestId('avatar')).toHaveTextContent('AD');
  });

  it('尺寸與 className 透傳', () => {
    render(<Avatar name="A" size={48} className="custom" data-testid="avatar" />);
    const avatar = screen.getByTestId('avatar');
    expect(avatar).toHaveClass('ge-avatar', 'custom');
    expect(avatar).toHaveStyle({ width: '48px' });
  });
});
