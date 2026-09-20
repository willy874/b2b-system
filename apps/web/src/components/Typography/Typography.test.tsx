import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Typography } from './index';

describe('Typography', () => {
  it('pageTitle 預設渲染成 h1', () => {
    render(<Typography variant="pageTitle">角色</Typography>);
    expect(screen.getByRole('heading', { level: 1, name: '角色' })).toBeInTheDocument();
  });

  it('可用 as 覆寫語意標籤（視覺與語意分離）', () => {
    render(
      <Typography variant="pageTitle" as="h2">
        角色
      </Typography>,
    );
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('tone 以 class 表現，不寫死顏色', () => {
    render(
      <Typography tone="danger" data-testid="text">
        錯誤
      </Typography>,
    );
    expect(screen.getByTestId('text')).toHaveClass('ge-typography--danger');
  });

  it('透傳 className 與 data-testid', () => {
    render(
      <Typography className="mt-2" data-testid="text">
        內容
      </Typography>,
    );
    expect(screen.getByTestId('text')).toHaveClass('mt-2');
  });
});
