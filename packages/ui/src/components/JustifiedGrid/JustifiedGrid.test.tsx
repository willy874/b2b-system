import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeLayout } from '../../testing/fakeLayout';
import { JustifiedGrid } from './index';
import type { GridItemRect, JustifiedGridSection } from './index';

let fake: ReturnType<typeof installFakeLayout>;

beforeEach(() => {
  fake = installFakeLayout();
  // 容器 1000 × 400；scrollHeight 預設很高（離底部很遠）
  fake.setSize('grid', { clientWidth: 1000, clientHeight: 400, scrollHeight: 100_000 });
});

afterEach(() => fake.restore());

function squares(key: string, count: number, label?: string): JustifiedGridSection {
  return {
    key,
    label,
    items: Array.from({ length: count }, (_, index) => ({
      key: `${key}-${index}`,
      aspectRatio: 1,
    })),
  };
}

const renderedKeys = () =>
  screen.queryAllByTestId('justified-grid-item').map((node) => node.getAttribute('data-value'));

describe('JustifiedGrid', () => {
  it('只渲染可視範圍（含 overscan）內的項目', () => {
    // 列高 200、gap 0：每列 5 張；可視 400 ＋ overscan 0 → 前兩列
    render(
      <JustifiedGrid
        data-testid="grid"
        sections={[squares('a', 500)]}
        rowHeight={200}
        gap={0}
        overscan={0}
        renderItem={(item) => item.key}
      />,
    );
    expect(renderedKeys()).toHaveLength(10);
    expect(renderedKeys()[0]).toBe('a-0');

    const root = screen.getByTestId('grid');
    fireEvent.scroll(root, { target: { scrollTop: 2000 } });
    expect(renderedKeys()[0]).toBe('a-50');
    expect(renderedKeys()).toHaveLength(10);
  });

  it('預設 overscan 是一個可視高度', () => {
    render(
      <JustifiedGrid
        data-testid="grid"
        sections={[squares('a', 500)]}
        rowHeight={200}
        gap={0}
        renderItem={(item) => item.key}
      />,
    );
    // 0～800 px：四列
    expect(renderedKeys()).toHaveLength(20);
  });

  it('renderItem 收到計算好的位置，外層容器的尺寸與它相同', () => {
    const renderItem = vi.fn((item: GridItemRect) => item.key);
    render(
      <JustifiedGrid
        data-testid="grid"
        sections={[
          {
            key: 'a',
            items: [
              { key: 'wide', aspectRatio: 2 },
              { key: 'tall', aspectRatio: 0.5 },
              { key: 'square', aspectRatio: 1 },
            ],
          },
        ]}
        rowHeight={300}
        gap={0}
        renderItem={renderItem}
      />,
    );
    // 2 ＋ 0.5 ＋ 1 = 3.5 → 1000 / 3.5 ≈ 285.7（≤ 300，斷列）
    expect(renderItem).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'wide', left: 0, top: 0, width: 571, height: 286 }),
    );
    const square = screen
      .getAllByTestId('justified-grid-item')
      .find((node) => node.getAttribute('data-value') === 'square');
    expect(square).toHaveStyle({ left: '714px', width: '286px', height: '286px' });
  });

  it('有 label 時顯示區段標題（預設內容是 label），沒有時不佔高度', () => {
    const { rerender } = render(
      <JustifiedGrid
        data-testid="grid"
        sections={[squares('a', 3, '第一段'), squares('b', 3, '第二段')]}
        rowHeight={200}
        gap={0}
        renderItem={(item) => item.key}
      />,
    );
    const headers = screen.getAllByTestId('justified-grid-header');
    expect(headers.map((node) => node.textContent)).toEqual(['第一段', '第二段']);
    expect(headers[0]).toHaveStyle({ height: '40px' });
    const first = screen.getAllByTestId('justified-grid-item')[0];
    expect(first).toHaveStyle({ top: '40px' });

    rerender(
      <JustifiedGrid
        data-testid="grid"
        sections={[squares('a', 3), squares('b', 3)]}
        rowHeight={200}
        gap={0}
        renderItem={(item) => item.key}
      />,
    );
    expect(screen.queryByTestId('justified-grid-header')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('justified-grid-item')[0]).toHaveStyle({ top: '0px' });
  });

  it('renderHeader 收到區段的位置與 label', () => {
    render(
      <JustifiedGrid
        data-testid="grid"
        sections={[squares('a', 3, '一')]}
        headerHeight={32}
        renderHeader={(section) => `${String(section.label)}：${section.itemCount}`}
        renderItem={(item) => item.key}
      />,
    );
    expect(screen.getByTestId('justified-grid-header')).toHaveTextContent('一：3');
  });

  it('內容不滿一屏時呼叫 onEndReached；同一個項目數只呼叫一次', () => {
    fake.setSize('grid', { scrollHeight: 200 });
    const onEndReached = vi.fn();
    const { rerender } = render(
      <JustifiedGrid
        data-testid="grid"
        sections={[squares('a', 5)]}
        onEndReached={onEndReached}
        renderItem={(item) => item.key}
      />,
    );
    expect(onEndReached).toHaveBeenCalledTimes(1);
    fireEvent.scroll(screen.getByTestId('grid'), { target: { scrollTop: 0 } });
    expect(onEndReached).toHaveBeenCalledTimes(1);

    rerender(
      <JustifiedGrid
        data-testid="grid"
        sections={[squares('a', 10)]}
        onEndReached={onEndReached}
        renderItem={(item) => item.key}
      />,
    );
    expect(onEndReached).toHaveBeenCalledTimes(2);
  });

  it('離底部遠時不呼叫 onEndReached，捲到門檻內才呼叫', () => {
    fake.setSize('grid', { scrollHeight: 5000 });
    const onEndReached = vi.fn();
    render(
      <JustifiedGrid
        data-testid="grid"
        sections={[squares('a', 100)]}
        onEndReached={onEndReached}
        endReachedThreshold={600}
        renderItem={(item) => item.key}
      />,
    );
    expect(onEndReached).not.toHaveBeenCalled();
    fireEvent.scroll(screen.getByTestId('grid'), { target: { scrollTop: 4100 } });
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it('還沒有任何項目時也呼叫 onEndReached（第一頁）', () => {
    const onEndReached = vi.fn();
    fake.setSize('grid', { scrollHeight: 0 });
    render(
      <JustifiedGrid
        data-testid="grid"
        sections={[]}
        onEndReached={onEndReached}
        renderItem={(item) => item.key}
      />,
    );
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it('onVisibleSectionChange 回報最上方的區段，onLayoutChange 收到版面', () => {
    const onVisibleSectionChange = vi.fn();
    const onLayoutChange = vi.fn();
    render(
      <JustifiedGrid
        data-testid="grid"
        sections={[squares('a', 25, 'A'), squares('b', 25, 'B')]}
        rowHeight={200}
        gap={0}
        onVisibleSectionChange={onVisibleSectionChange}
        onLayoutChange={onLayoutChange}
        renderItem={(item) => item.key}
      />,
    );
    expect(onVisibleSectionChange).toHaveBeenLastCalledWith('a');
    expect(onLayoutChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 1000, height: 2080 }),
    );
    // a：40 ＋ 5 列 × 200 = 1040，b 從 1040 開始
    fireEvent.scroll(screen.getByTestId('grid'), { target: { scrollTop: 1100 } });
    expect(onVisibleSectionChange).toHaveBeenLastCalledWith('b');
    expect(onVisibleSectionChange).toHaveBeenCalledTimes(2);
  });

  it('容器寬度改變時重算版面', () => {
    render(
      <JustifiedGrid
        data-testid="grid"
        sections={[squares('a', 10)]}
        mode="square"
        rowHeight={200}
        gap={0}
        renderItem={(item) => item.key}
      />,
    );
    expect(screen.getAllByTestId('justified-grid-item')[0]).toHaveStyle({ width: '200px' });
    fake.setSize('grid', { clientWidth: 500 });
    fake.resize();
    expect(screen.getAllByTestId('justified-grid-item')[0]).toHaveStyle({ width: '250px' });
  });

  it('ref、className、data-testid、aria-* 透傳到捲動容器；testIds 換掉內層的 testid', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <JustifiedGrid
        ref={ref}
        data-testid="grid"
        className="custom"
        aria-label="清單"
        sections={[squares('a', 2, 'A')]}
        testIds={{ item: 'cell', header: 'heading' }}
        classNames={{ item: 'cell-class' }}
        renderItem={(item) => item.key}
      />,
    );
    const root = screen.getByTestId('grid');
    expect(ref.current).toBe(root);
    expect(root).toHaveClass('custom');
    expect(root).toHaveAttribute('aria-label', '清單');
    expect(screen.getAllByTestId('cell')[0]).toHaveAttribute('data-value', 'a-0');
    expect(screen.getAllByTestId('cell')[0]).toHaveClass('cell-class');
    expect(screen.getByTestId('heading')).toHaveTextContent('A');
  });
});
