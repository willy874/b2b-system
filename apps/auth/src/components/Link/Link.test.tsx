import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Link } from './index';

describe('Link', () => {
  it('預設渲染成 <a>', () => {
    render(<Link href="/role">角色</Link>);
    const link = screen.getByRole('link', { name: '角色' });
    expect(link).toHaveAttribute('href', '/role');
    expect(link).toHaveAttribute('data-tone', 'brand');
    expect(link).toHaveAttribute('data-underline', 'hover');
  });

  it('可用 render 換成別的元素，樣式仍然套用', () => {
    function RouterLink(props: { className?: string; children?: React.ReactNode }) {
      return <button type="button" {...props} />;
    }
    render(
      <Link render={<RouterLink />} tone="danger">
        刪除
      </Link>,
    );
    const rendered = screen.getByRole('button', { name: '刪除' });
    expect(rendered).toHaveAttribute('data-tone', 'danger');
    expect(rendered.className).not.toBe('');
  });

  it('鍵盤可聚焦並觸發', async () => {
    const onClick = vi.fn();
    render(
      <Link href="#target" onClick={onClick}>
        前往
      </Link>,
    );
    await userEvent.tab();
    expect(screen.getByRole('link', { name: '前往' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalled();
  });

  it('透傳 data-testid', () => {
    render(
      <Link href="/x" data-testid="my-link">
        x
      </Link>,
    );
    expect(screen.getByTestId('my-link')).toBeInTheDocument();
  });
});
