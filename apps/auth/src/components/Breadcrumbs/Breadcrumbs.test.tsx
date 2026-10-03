import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Breadcrumbs } from './index';

const items = [
  { key: 'home', label: '首頁', href: '/' },
  { key: 'role', label: '角色', href: '/role' },
  { key: 'detail', label: '系統管理員' },
];

describe('Breadcrumbs', () => {
  it('以 navigation 角色曝露', () => {
    render(<Breadcrumbs items={items} />);
    expect(screen.getByRole('navigation', { name: 'breadcrumb' })).toBeInTheDocument();
  });

  it('最後一項不是連結，且標記為當前頁面', () => {
    render(<Breadcrumbs items={items} />);
    const current = screen.getByText('系統管理員');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: '系統管理員' })).not.toBeInTheDocument();
  });

  it('其餘項目是可點擊的連結', () => {
    render(<Breadcrumbs items={items} />);
    expect(screen.getByRole('link', { name: '首頁' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '角色' })).toHaveAttribute('href', '/role');
  });

  it('分隔符號對輔助技術隱藏', () => {
    const { container } = render(<Breadcrumbs items={items} />);
    const separators = container.querySelectorAll('li[aria-hidden="true"]');
    expect(separators).toHaveLength(2);
    for (const separator of separators) expect(separator).toHaveAttribute('aria-hidden', 'true');
  });
});
