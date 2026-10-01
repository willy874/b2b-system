import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScrollArea } from './index';

/** jsdom 沒有版面，捲動尺寸都是 0；Base UI 1.x 只在內容溢出時渲染捲軸，要模擬溢出才看得到 */
function mockOverflow() {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
}

describe('ScrollArea', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染內容並套上 maxHeight', () => {
    render(
      <ScrollArea maxHeight={200} testIds={{ viewport: 'viewport' }}>
        <p>很長的內容</p>
      </ScrollArea>,
    );
    expect(screen.getByText('很長的內容')).toBeInTheDocument();
    expect(screen.getByTestId('viewport')).toHaveStyle({ maxHeight: '200px' });
  });

  it('內容沒有溢出時不渲染捲軸', () => {
    render(
      <ScrollArea orientation="both" testIds={{ scrollbar: 'scrollbar' }}>
        <p>內容</p>
      </ScrollArea>,
    );
    expect(screen.queryByTestId('scrollbar')).not.toBeInTheDocument();
  });

  it('預設只有垂直捲軸', async () => {
    mockOverflow();
    render(
      <ScrollArea testIds={{ scrollbar: 'scrollbar' }}>
        <p>內容</p>
      </ScrollArea>,
    );
    const scrollbars = await screen.findAllByTestId('scrollbar');
    expect(scrollbars).toHaveLength(1);
    expect(scrollbars[0]).toHaveAttribute('data-orientation', 'vertical');
  });

  it('orientation=both 時有兩個捲軸', async () => {
    mockOverflow();
    render(
      <ScrollArea orientation="both" testIds={{ scrollbar: 'scrollbar' }}>
        <p>內容</p>
      </ScrollArea>,
    );
    const scrollbars = await screen.findAllByTestId('scrollbar');
    expect(scrollbars.map((bar) => bar.getAttribute('data-orientation'))).toEqual([
      'vertical',
      'horizontal',
    ]);
  });

  it('透傳 className', () => {
    render(
      <ScrollArea className="custom" data-testid="scroll">
        <p>內容</p>
      </ScrollArea>,
    );
    expect(screen.getByTestId('scroll')).toHaveClass('custom');
  });
});
