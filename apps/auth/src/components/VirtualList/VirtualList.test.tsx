import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFakeListLayout } from '@/test/fakeLayout';

import { useListNavigation, VirtualList } from './index';

const renderedCount = () => document.querySelectorAll('[data-testid="virtual-list-item"]').length;

const words = ['apple', 'avocado', 'banana', 'blueberry', 'cherry'];

function key(name: string, init: Partial<KeyboardEvent> = {}) {
  return { key: name, preventDefault: vi.fn(), ...init } as unknown as KeyboardEvent;
}

describe('useListNavigation', () => {
  const setup = (options: Partial<Parameters<typeof useListNavigation>[0]> = {}) =>
    renderHook(() =>
      useListNavigation({
        count: words.length,
        isDisabled: (index) => index === 1,
        getLabel: (index) => words[index],
        ...options,
      }),
    );

  it('↓／↑ 跳過停用的列，到底不繞回（loop=false）', () => {
    const { result } = setup();
    act(() => void result.current.handleKeyDown(key('ArrowDown')));
    expect(result.current.activeIndex).toBe(0);
    act(() => void result.current.handleKeyDown(key('ArrowDown')));
    expect(result.current.activeIndex).toBe(2);
    act(() => void result.current.handleKeyDown(key('End')));
    act(() => void result.current.handleKeyDown(key('ArrowDown')));
    expect(result.current.activeIndex).toBe(4);
  });

  it('loop=true 時到底繞回開頭', () => {
    const { result } = setup({ loop: true });
    act(() => void result.current.handleKeyDown(key('End')));
    act(() => void result.current.handleKeyDown(key('ArrowDown')));
    expect(result.current.activeIndex).toBe(0);
  });

  it('typeahead：連打同一字母在同字首的列之間輪替（跳過停用）', () => {
    const { result } = setup();
    act(() => void result.current.handleKeyDown(key('b')));
    expect(result.current.activeIndex).toBe(2);
    act(() => void result.current.handleKeyDown(key('b')));
    expect(result.current.activeIndex).toBe(3);
  });

  it('鍵盤移動會呼叫 onNavigate，setActiveIndex（滑鼠移過）不會', () => {
    const onNavigate = vi.fn();
    const { result } = setup({ onNavigate });
    act(() => result.current.setActiveIndex(3));
    expect(onNavigate).not.toHaveBeenCalled();
    act(() => void result.current.handleKeyDown(key('Home')));
    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it('不處理的按鍵回傳 false、不 preventDefault', () => {
    const { result } = setup();
    const event = key('Enter');
    let handled = true;
    act(() => {
      handled = result.current.handleKeyDown(event);
    });
    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('VirtualList', () => {
  let layout: ReturnType<typeof installFakeListLayout> | undefined;
  afterEach(() => {
    layout?.restore();
    layout = undefined;
  });

  const items = Array.from({ length: 1000 }, (_, index) => `row ${index}`);

  it('未達門檻時全部渲染', () => {
    render(
      <VirtualList
        items={items.slice(0, 20)}
        getKey={(item) => item}
        renderItem={(item) => item}
      />,
    );
    expect(renderedCount()).toBe(20);
  });

  it('超過門檻時只渲染可視範圍，並撐出總高度', () => {
    layout = installFakeListLayout({ rowHeight: 40, viewportHeight: 400 });
    render(
      <VirtualList
        items={items}
        estimateSize={40}
        getKey={(item) => item}
        renderItem={(item) => item}
        data-testid="list"
      />,
    );
    expect(renderedCount()).toBeLessThan(40);
    expect(screen.getByRole('list')).toHaveStyle({ height: '40000px' });
  });

  it('筆數跨過門檻、切換成虛擬捲動時保留捲動位置（不彈回頂端）', () => {
    layout = installFakeListLayout({ rowHeight: 40, viewportHeight: 400 });
    const props = { getKey: (item: string) => item, renderItem: (item: string) => item };
    const { rerender } = render(
      <VirtualList {...props} items={items.slice(0, 100)} estimateSize={40} data-testid="list" />,
    );
    const scroller = screen.getByTestId('list');
    scroller.scrollTop = 3000;
    rerender(
      <VirtualList {...props} items={items.slice(0, 120)} estimateSize={40} data-testid="list" />,
    );
    expect(scroller.scrollTop).toBe(3000);
    expect(renderedCount()).toBeLessThan(40);
  });

  it('捲到底部時呼叫 onLoadMore，同一筆數只呼叫一次', () => {
    const onLoadMore = vi.fn();
    render(
      <VirtualList
        items={items.slice(0, 5)}
        getKey={(item) => item}
        renderItem={(item) => item}
        hasMore
        onLoadMore={onLoadMore}
        data-testid="list"
      />,
    );
    // jsdom 沒有布局，內容高度為 0 → 視為不滿一屏，掛上時就要下一頁
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    fireEvent.scroll(screen.getByTestId('list'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('載入失敗（loading 結束但筆數沒變）後，再捲動才重試', () => {
    const onLoadMore = vi.fn();
    const props = {
      items: items.slice(0, 5),
      getKey: (item: string) => item,
      renderItem: (item: string) => item,
      hasMore: true,
      onLoadMore,
      'data-testid': 'list',
    };
    const { rerender } = render(<VirtualList {...props} />);
    rerender(<VirtualList {...props} loading />);
    rerender(<VirtualList {...props} loading={false} />);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    fireEvent.scroll(screen.getByTestId('list'));
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('沒有資料時顯示 emptyContent', () => {
    render(<VirtualList items={[]} getKey={String} renderItem={String} emptyContent="沒有資料" />);
    expect(screen.getByText('沒有資料')).toBeInTheDocument();
  });
});
