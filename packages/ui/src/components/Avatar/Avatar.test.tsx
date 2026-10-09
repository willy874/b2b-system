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
    expect(avatar).toHaveClass('custom');
    expect(avatar).toHaveStyle({ width: '48px' });
  });

  it('image：呼叫端的圖片疊在縮寫上面，縮寫仍在（圖片沒畫出來時的退路）', () => {
    render(
      <Avatar
        name="Alice Chen"
        image={<img alt="Alice Chen" src="https://files.test/a.jpg" />}
        testIds={{ image: 'avatar-image' }}
        data-testid="avatar"
      />,
    );
    expect(screen.getByTestId('avatar-image')).toContainElement(
      screen.getByRole('img', { name: 'Alice Chen' }),
    );
    expect(screen.getByTestId('avatar')).toHaveTextContent('AC');
  });

  it('image 是 null（呼叫端沒有圖可畫）：只有縮寫', () => {
    render(<Avatar name="Alice Chen" image={null} testIds={{ image: 'avatar-image' }} />);
    expect(screen.queryByTestId('avatar-image')).not.toBeInTheDocument();
  });
});
