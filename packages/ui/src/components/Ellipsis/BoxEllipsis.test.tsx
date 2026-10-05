import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeLayout } from '../../testing/fakeLayout';
import { TooltipProvider } from '../Tooltip';
import { BoxEllipsis, fitCount } from './index';

let layout: ReturnType<typeof installFakeLayout>;

beforeEach(() => {
  layout = installFakeLayout();
  // 三個項目各 50px，溢出區 30px（jsdom 沒有套用 CSS，gap 為 0）
  for (const id of ['a', 'b', 'c']) layout.setSize(id, { width: 50 });
  layout.setSize('overflow', { width: 30 });
});

afterEach(() => {
  layout.restore();
});

function renderBox(ui: ReactElement) {
  return render(<TooltipProvider delay={0}>{ui}</TooltipProvider>);
}

const ITEMS = [
  <span key="a" data-testid="a">
    甲
  </span>,
  <span key="b" data-testid="b">
    乙
  </span>,
  <span key="c" data-testid="c">
    丙
  </span>,
];

function visibleItems() {
  return ['a', 'b', 'c'].filter((id) => screen.queryByTestId(id) !== null);
}

describe('fitCount（可見數量的計算）', () => {
  it.each([
    { available: 200, limit: Infinity, expected: 3, note: '全部放得下' },
    { available: 150, limit: Infinity, expected: 3, note: '剛好放得下，不預留溢出區' },
    { available: 140, limit: Infinity, expected: 2, note: '放不下時預留溢出區寬度' },
    { available: 100, limit: Infinity, expected: 1, note: '只放得下一個' },
    { available: 20, limit: Infinity, expected: 0, note: '連一個都放不下' },
    { available: 200, limit: 1, expected: 1, note: '受 maxVisible 限制' },
  ])('$note', ({ available, limit, expected }) => {
    expect(fitCount([50, 50, 50], 30, 0, available, limit)).toBe(expected);
  });

  it('計入項目之間的 gap', () => {
    // 50 + 8 + 50 + 8 + 50 = 166
    expect(fitCount([50, 50, 50], 30, 8, 166, Infinity)).toBe(3);
    expect(fitCount([50, 50, 50], 30, 8, 165, Infinity)).toBe(2);
  });
});

describe('BoxEllipsis', () => {
  it('寬度足夠時全部顯示，沒有溢出區', () => {
    layout.setSize('box', { clientWidth: 200 });
    renderBox(
      <BoxEllipsis data-testid="box" testIds={{ overflow: 'overflow' }}>
        {ITEMS}
      </BoxEllipsis>,
    );
    expect(visibleItems()).toEqual(['a', 'b', 'c']);
    expect(screen.queryByTestId('overflow')).not.toBeInTheDocument();
    expect(screen.getByTestId('box')).not.toHaveAttribute('data-overflowing');
  });

  it('放不下的項目從尾端收進 +N，hover 列出被隱藏的項目', async () => {
    layout.setSize('box', { clientWidth: 140 });
    renderBox(
      <BoxEllipsis data-testid="box" testIds={{ overflow: 'overflow' }}>
        {ITEMS}
      </BoxEllipsis>,
    );
    expect(visibleItems()).toEqual(['a', 'b']);
    expect(screen.getByTestId('overflow')).toHaveTextContent('+1');
    expect(screen.getByTestId('box')).toHaveAttribute('data-overflowing');

    await userEvent.hover(screen.getByText('+1'));
    expect(await screen.findByTestId('c')).toBeVisible();
  });

  it('容器縮放時重新計算，並通知隱藏數量', () => {
    const onOverflowChange = vi.fn();
    layout.setSize('box', { clientWidth: 200 });
    renderBox(
      <BoxEllipsis
        data-testid="box"
        testIds={{ overflow: 'overflow' }}
        onOverflowChange={onOverflowChange}
      >
        {ITEMS}
      </BoxEllipsis>,
    );

    layout.setSize('box', { clientWidth: 100 });
    layout.resize();
    expect(visibleItems()).toEqual(['a']);
    expect(onOverflowChange).toHaveBeenLastCalledWith(2);

    layout.setSize('box', { clientWidth: 200 });
    layout.resize();
    expect(visibleItems()).toEqual(['a', 'b', 'c']);
    expect(onOverflowChange).toHaveBeenLastCalledWith(0);
  });

  it('maxVisible 限制最多顯示的數量', () => {
    layout.setSize('box', { clientWidth: 500 });
    renderBox(<BoxEllipsis maxVisible={1}>{ITEMS}</BoxEllipsis>);
    expect(visibleItems()).toEqual(['a']);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('maxVisible 可依容器寬度決定（隱藏判斷點）', () => {
    layout.setSize('box', { clientWidth: 500 });
    renderBox(
      <BoxEllipsis data-testid="box" maxVisible={(width) => (width < 300 ? 0 : Infinity)}>
        {ITEMS}
      </BoxEllipsis>,
    );
    expect(visibleItems()).toEqual(['a', 'b', 'c']);

    layout.setSize('box', { clientWidth: 250 });
    layout.resize();
    expect(visibleItems()).toEqual([]);
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('fit={false} 時不看寬度，只看 maxVisible', () => {
    layout.setSize('box', { clientWidth: 60 });
    renderBox(
      <BoxEllipsis data-testid="box" fit={false} maxVisible={2}>
        {ITEMS}
      </BoxEllipsis>,
    );
    expect(visibleItems()).toEqual(['a', 'b']);
  });

  it('renderOverflow 自訂隱藏替代節點', () => {
    layout.setSize('box', { clientWidth: 100 });
    renderBox(
      <BoxEllipsis
        data-testid="box"
        testIds={{ overflow: 'overflow' }}
        renderOverflow={({ hiddenCount, visibleCount }) => (
          <span>
            另有 {hiddenCount} 項（已顯示 {visibleCount} 項）
          </span>
        )}
      >
        {ITEMS}
      </BoxEllipsis>,
    );
    expect(screen.getByText('另有 2 項（已顯示 1 項）')).toBeInTheDocument();
  });

  it('項目增加時重新量測', async () => {
    layout.setSize('box', { clientWidth: 140 });
    const { rerender } = renderBox(
      <BoxEllipsis data-testid="box">{ITEMS.slice(0, 2)}</BoxEllipsis>,
    );
    expect(visibleItems()).toEqual(['a', 'b']);

    rerender(
      <TooltipProvider delay={0}>
        <BoxEllipsis data-testid="box">{ITEMS}</BoxEllipsis>
      </TooltipProvider>,
    );
    await waitFor(() => expect(visibleItems()).toEqual(['a', 'b']));
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('未布局（容器寬度 0）時全部顯示', () => {
    renderBox(<BoxEllipsis>{ITEMS}</BoxEllipsis>);
    expect(visibleItems()).toEqual(['a', 'b', 'c']);
  });
});
