import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthShell } from './AuthShell';

describe('AuthShell（不套外框的頁面）', () => {
  it('顯示產品名、標題、說明、內容與頁尾', () => {
    render(
      <AuthShell
        brand="B2B System"
        title="登入"
        description="請輸入帳號"
        footer={<a href="/">返回</a>}
      >
        <form aria-label="登入表單" />
      </AuthShell>,
    );
    expect(screen.getByText('B2B System')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '登入' })).toBeInTheDocument();
    expect(screen.getByText('請輸入帳號')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: '登入表單' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回' })).toBeInTheDocument();
  });

  it('沒有說明與頁尾時不渲染空的段落', () => {
    const { container } = render(
      <AuthShell brand="B2B System" title="登入">
        <p>內容</p>
      </AuthShell>,
    );
    // 卡片裡只有產品名、標題與內容
    expect(container.firstElementChild?.firstElementChild?.children).toHaveLength(3);
  });
});
