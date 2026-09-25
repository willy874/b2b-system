import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { installFakeListLayout } from '@/test/fakeLayout';

import { toJsonLines } from './jsonLines';
import { JsonViewer } from './JsonViewer';

const lineTexts = () =>
  Array.from(document.querySelectorAll('[data-testid="json-viewer-item"]'), (line) =>
    line.textContent?.trim(),
  );

const expandAll = () => false;

describe('toJsonLines', () => {
  it('展開的物件攤成多行，最後一個元素不接逗號', () => {
    const lines = toJsonLines({ a: 1, b: [true, null] }, expandAll);
    expect(lines.map((line) => [line.type, line.path, line.comma])).toEqual([
      ['open', '$', false],
      ['value', '$["a"]', true],
      ['open', '$["b"]', false],
      ['value', '$["b"][0]', true],
      ['value', '$["b"][1]', false],
      ['close', '$["b"]', false],
      ['close', '$', false],
    ]);
  });

  it('收合的容器與空容器只佔一行', () => {
    const lines = toJsonLines({ a: { x: 1 }, b: [] }, (path) => path === '$["a"]');
    expect(lines.filter((line) => line.type === 'collapsed').map((line) => line.path)).toEqual([
      '$["a"]',
      '$["b"]',
    ]);
  });

  it('循環參照不會無限展開', () => {
    const value: Record<string, unknown> = { a: 1 };
    value.self = value;
    const lines = toJsonLines(value, expandAll);
    expect(lines.find((line) => line.path === '$["self"]')).toMatchObject({ text: '[Circular]' });
  });
});

describe('JsonViewer', () => {
  let layout: ReturnType<typeof installFakeListLayout> | undefined;
  afterEach(() => {
    layout?.restore();
    layout = undefined;
  });

  it('鍵名不加引號，字串值保留引號與逗號', () => {
    render(<JsonViewer value={{ name: 'a', count: 2 }} />);
    expect(lineTexts()).toEqual(['{', 'name: "a",', 'count: 2', '}']);
  });

  it('點箭頭收合與展開，收合時顯示摘要', () => {
    render(
      <JsonViewer
        value={{ list: [1, 2, 3] }}
        labels={{ collapse: '收', expand: '展', summary: (size) => `${size} items` }}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: '收' })[1] as HTMLElement);
    expect(lineTexts()).toEqual(['{', 'list: […]3 items', '}']);

    fireEvent.click(screen.getByRole('button', { name: '展' }));
    expect(lineTexts()).toHaveLength(7);
  });

  it('defaultExpandDepth 以下的容器一開始是收合的', () => {
    render(<JsonViewer value={{ a: { b: { c: 1 } } }} defaultExpandDepth={1} />);
    expect(lineTexts()).toEqual(['{', 'a: {…}1 個欄位', '}']);
  });

  it('換一份資料時收合狀態回到預設', () => {
    const { rerender } = render(<JsonViewer value={{ a: [1] }} labels={{ collapse: '收' }} />);
    fireEvent.click(screen.getAllByRole('button', { name: '收' })[1] as HTMLElement);
    expect(lineTexts()).toHaveLength(3);
    rerender(<JsonViewer value={{ a: [1] }} labels={{ collapse: '收' }} />);
    expect(lineTexts()).toHaveLength(5);
  });

  it('套用 maxHeight，aria-label 讓捲動框成為 region', () => {
    render(<JsonViewer value={{}} maxHeight={120} aria-label="明細" data-testid="viewer" />);
    const viewer = screen.getByRole('region', { name: '明細' });
    expect(viewer).toHaveStyle({ maxHeight: '120px' });
    expect(viewer).toHaveAttribute('data-testid', 'viewer');
  });

  it('行數超過門檻時只渲染可視範圍', () => {
    layout = installFakeListLayout({ rowHeight: 20, viewportHeight: 200 });
    const value = Array.from({ length: 1000 }, (_, index) => index);
    render(<JsonViewer value={value} />);
    expect(lineTexts().length).toBeLessThan(40);
  });
});
