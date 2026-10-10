import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '../Button';
import { PageHeader } from './index';

describe('PageHeader', () => {
  it('標題是 h1，顯示說明與右側的操作', () => {
    render(
      <PageHeader title="使用者" description="管理帳號" actions={<Button>建立使用者</Button>} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: '使用者' })).toBeInTheDocument();
    expect(screen.getByText('管理帳號')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '建立使用者' })).toBeInTheDocument();
  });

  it('沒有說明、沒有操作時不渲染那兩層', () => {
    render(
      <PageHeader title="角色" testIds={{ description: 'description', actions: 'actions' }} />,
    );
    expect(screen.queryByTestId('description')).toBeNull();
    expect(screen.queryByTestId('actions')).toBeNull();
  });

  it('truncate 以 data 屬性表達', () => {
    render(<PageHeader title="很長的名稱" truncate />);
    expect(screen.getByRole('heading')).toHaveAttribute('data-truncate', 'true');
  });
});
