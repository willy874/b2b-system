import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ScrollArea } from './index';

describe('ScrollArea', () => {
  it('渲染內容並套上 maxHeight', () => {
    render(
      <ScrollArea maxHeight={200} data-testid="scroll">
        <p>很長的內容</p>
      </ScrollArea>,
    );
    expect(screen.getByText('很長的內容')).toBeInTheDocument();
    const viewport = screen.getByTestId('scroll').querySelector('.ge-scroll-area__viewport');
    expect(viewport).toHaveStyle({ maxHeight: '200px' });
  });

  it('預設只有垂直捲軸', () => {
    render(
      <ScrollArea data-testid="scroll">
        <p>內容</p>
      </ScrollArea>,
    );
    const scrollbars = screen.getByTestId('scroll').querySelectorAll('.ge-scroll-area__scrollbar');
    expect(scrollbars).toHaveLength(1);
  });

  it('orientation=both 時有兩個捲軸', () => {
    render(
      <ScrollArea orientation="both" data-testid="scroll">
        <p>內容</p>
      </ScrollArea>,
    );
    const scrollbars = screen.getByTestId('scroll').querySelectorAll('.ge-scroll-area__scrollbar');
    expect(scrollbars).toHaveLength(2);
  });

  it('透傳 className', () => {
    render(
      <ScrollArea className="custom" data-testid="scroll">
        <p>內容</p>
      </ScrollArea>,
    );
    expect(screen.getByTestId('scroll')).toHaveClass('ge-scroll-area', 'custom');
  });
});
