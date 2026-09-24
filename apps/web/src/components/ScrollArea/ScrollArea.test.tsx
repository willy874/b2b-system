import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ScrollArea } from './index';

describe('ScrollArea', () => {
  it('渲染內容並套上 maxHeight', () => {
    render(
      <ScrollArea maxHeight={200} testIds={{ viewport: 'viewport' }}>
        <p>很長的內容</p>
      </ScrollArea>,
    );
    expect(screen.getByText('很長的內容')).toBeInTheDocument();
    expect(screen.getByTestId('viewport')).toHaveStyle({ maxHeight: '200px' });
  });

  it('預設只有垂直捲軸', () => {
    render(
      <ScrollArea testIds={{ scrollbar: 'scrollbar' }}>
        <p>內容</p>
      </ScrollArea>,
    );
    const scrollbars = screen.getAllByTestId('scrollbar');
    expect(scrollbars).toHaveLength(1);
    expect(scrollbars[0]).toHaveAttribute('data-orientation', 'vertical');
  });

  it('orientation=both 時有兩個捲軸', () => {
    render(
      <ScrollArea orientation="both" testIds={{ scrollbar: 'scrollbar' }}>
        <p>內容</p>
      </ScrollArea>,
    );
    const scrollbars = screen.getAllByTestId('scrollbar');
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
