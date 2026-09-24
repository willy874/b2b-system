import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Paragraph, Text, Title, Typography } from './index';

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

  it('variant、tone、strong 以 data-* 屬性表達，不寫死顏色', () => {
    render(
      <Typography tone="danger" strong data-testid="text">
        錯誤
      </Typography>,
    );
    const text = screen.getByTestId('text');
    expect(text).toHaveAttribute('data-variant', 'body');
    expect(text).toHaveAttribute('data-tone', 'danger');
    expect(text).toHaveAttribute('data-strong');
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

describe('Title', () => {
  it.each([
    [1, 'pageTitle'],
    [2, 'sectionTitle'],
    [3, 'bodyStrong'],
  ] as const)('level %i 渲染成 h%i，外觀是 %s', (level, variant) => {
    render(<Title level={level}>標題</Title>);
    const heading = screen.getByRole('heading', { level, name: '標題' });
    expect(heading).toHaveAttribute('data-variant', variant);
  });

  it('as 可以只換標籤、保留外觀', () => {
    render(
      <Title level={1} as="h2">
        標題
      </Title>,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('data-variant', 'pageTitle');
  });
});

describe('Text', () => {
  it('預設渲染成行內 span', () => {
    render(<Text data-testid="text">內容</Text>);
    expect(screen.getByTestId('text').tagName).toBe('SPAN');
  });

  it.each([
    [{}, 'body'],
    [{ size: 'sm' }, 'caption'],
    [{ code: true }, 'code'],
    [{ code: true, size: 'sm' }, 'code'],
  ] as const)('%o → variant %s', (props, variant) => {
    render(
      <Text data-testid="text" {...props}>
        內容
      </Text>,
    );
    expect(screen.getByTestId('text')).toHaveAttribute('data-variant', variant);
  });
});

describe('Paragraph', () => {
  it('預設渲染成 p，size="sm" 用 caption 外觀', () => {
    render(
      <Paragraph size="sm" data-testid="text">
        說明
      </Paragraph>,
    );
    const text = screen.getByTestId('text');
    expect(text.tagName).toBe('P');
    expect(text).toHaveAttribute('data-variant', 'caption');
  });
});
