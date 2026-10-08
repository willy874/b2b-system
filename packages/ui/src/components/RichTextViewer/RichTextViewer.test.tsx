import type { RichTextDocument, RichTextNode } from '@b2b-system/rich-text';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RichTextViewer } from './RichTextViewer';

const text = (value: string, marks?: RichTextNode['marks']): RichTextNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: RichTextNode[]): RichTextNode => ({ type: 'paragraph', content });
const doc = (...content: RichTextNode[]): RichTextDocument => ({ type: 'doc', content });

const renderViewer = (value: RichTextDocument) =>
  render(<RichTextViewer value={value} data-testid="viewer" />);

describe('RichTextViewer', () => {
  it('區塊節點渲染成對應的 HTML 元素', () => {
    renderViewer(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('標題')] },
        { type: 'heading', attrs: { level: 3 }, content: [text('小標題')] },
        paragraph(text('內文')),
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph(text('項目'))] }],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [{ type: 'listItem', content: [paragraph(text('第三'))] }],
        },
        { type: 'blockquote', content: [paragraph(text('引言'))] },
        { type: 'codeBlock', content: [text('const a = 1;\nconst b = 2;')] },
        { type: 'horizontalRule' },
      ),
    );
    expect(screen.getByRole('heading', { level: 2, name: '標題' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '小標題' })).toBeInTheDocument();
    expect(screen.getByText('內文').closest('p')).toBeInTheDocument();
    expect(screen.getAllByRole('list')).toHaveLength(2);
    expect(screen.getByText('第三').closest('ol')).toHaveAttribute('start', '3');
    expect(screen.getByText('引言').closest('blockquote')).toBeInTheDocument();
    expect(screen.getByText(/const a = 1;/).closest('pre')).toHaveTextContent(
      'const a = 1; const b = 2;',
    );
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('行內標記渲染成 strong、em、u、s、code，順序由外往內', () => {
    renderViewer(
      doc(
        paragraph(
          text('粗斜', [{ type: 'bold' }, { type: 'italic' }]),
          text('底線', [{ type: 'underline' }]),
          text('刪除', [{ type: 'strike' }]),
          text('程式', [{ type: 'code' }]),
        ),
      ),
    );
    expect(screen.getByText('粗斜').tagName).toBe('EM');
    expect(screen.getByText('粗斜').parentElement?.tagName).toBe('STRONG');
    expect(screen.getByText('底線').tagName).toBe('U');
    expect(screen.getByText('刪除').tagName).toBe('S');
    expect(screen.getByText('程式').tagName).toBe('CODE');
  });

  it('連結在新分頁開啟，帶 noopener', () => {
    renderViewer(
      doc(paragraph(text('官網', [{ type: 'link', attrs: { href: 'https://example.com' } }]))),
    );
    const link = screen.getByRole('link', { name: '官網' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  it('不安全的連結（javascript:）只顯示文字，不渲染成連結', () => {
    renderViewer(
      doc(paragraph(text('點我', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))),
    );
    expect(screen.getByText('點我')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('文字裡的 HTML 原樣顯示，不會被解析', () => {
    renderViewer(doc(paragraph(text('<img src=x onerror=alert(1)>'))));
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByTestId('viewer').querySelector('img')).toBeNull();
  });

  it('認不得的節點與標記保留裡面的文字', () => {
    renderViewer(
      doc(
        { type: 'mention', content: [text('@某人')] },
        paragraph(text('螢光', [{ type: 'highlight' }])),
      ),
    );
    expect(screen.getByText('@某人')).toBeInTheDocument();
    expect(screen.getByText('螢光')).toBeInTheDocument();
  });

  it('太深的巢狀只顯示純文字', () => {
    let node: RichTextNode = paragraph(text('最裡面'));
    for (let depth = 0; depth < 100; depth += 1) node = { type: 'blockquote', content: [node] };
    renderViewer(doc(node));
    expect(screen.getByText('最裡面')).toBeInTheDocument();
    expect(screen.getByTestId('viewer').querySelectorAll('blockquote').length).toBeLessThan(40);
  });

  it('沒有值時渲染空的容器', () => {
    render(<RichTextViewer value={undefined} data-testid="viewer" />);
    expect(screen.getByTestId('viewer')).toBeEmptyDOMElement();
  });

  it('透傳 className、style 與 aria-label', () => {
    render(
      <RichTextViewer
        value={doc(paragraph(text('a')))}
        className="extra"
        style={{ maxWidth: 100 }}
        aria-label="說明"
        data-testid="viewer"
      />,
    );
    const root = screen.getByTestId('viewer');
    expect(root).toHaveClass('extra');
    expect(root).toHaveStyle({ maxWidth: '100px' });
    expect(root).toHaveAttribute('aria-label', '說明');
  });
});
