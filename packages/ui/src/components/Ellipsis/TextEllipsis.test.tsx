import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeLayout } from '../../testing/fakeLayout';
import { TooltipProvider } from '../Tooltip';
import { TextEllipsis } from './index';

let layout: ReturnType<typeof installFakeLayout>;
const setSize: ReturnType<typeof installFakeLayout>['setSize'] = (...args) =>
  layout.setSize(...args);
const resize = () => layout.resize();

beforeEach(() => {
  layout = installFakeLayout();
});

afterEach(() => {
  layout.restore();
});

/** Base UI 的提示框沒有 role；內容與觸發元素相同時，出現第二份文字即代表提示已開啟。 */
async function expectTooltipShowing(text: string) {
  await waitFor(() => expect(screen.getAllByText(text)).toHaveLength(2));
}

function expectTooltipHidden(text: string) {
  expect(screen.getAllByText(text)).toHaveLength(1);
}

function renderInContainer(ui: ReactElement) {
  return render(
    <TooltipProvider delay={0}>
      <div data-testid="container">{ui}</div>
    </TooltipProvider>,
  );
}

describe('TextEllipsis', () => {
  it('內容放得下時 hover 不顯示提示', async () => {
    setSize('text', { clientWidth: 100, scrollWidth: 100 });
    renderInContainer(<TextEllipsis data-testid="text">完整的說明文字</TextEllipsis>);
    await userEvent.hover(screen.getByTestId('text'));
    expectTooltipHidden('完整的說明文字');
    expect(screen.getByTestId('text')).not.toHaveAttribute('data-truncated');
  });

  it('被截斷時標記 data-truncated，hover 顯示完整內容', async () => {
    setSize('text', { clientWidth: 60, scrollWidth: 120 });
    renderInContainer(<TextEllipsis data-testid="text">完整的說明文字</TextEllipsis>);
    const text = screen.getByTestId('text');
    expect(text).toHaveAttribute('data-truncated');
    await userEvent.hover(text);
    await expectTooltipShowing('完整的說明文字');
  });

  it('多行時以高度判斷是否截斷', () => {
    setSize('text', { clientWidth: 100, clientHeight: 40, scrollHeight: 80 });
    renderInContainer(
      <TextEllipsis data-testid="text" lines={2}>
        很長的多行內容
      </TextEllipsis>,
    );
    const text = screen.getByTestId('text');
    expect(text).toHaveAttribute('data-multiline');
    expect(text).toHaveAttribute('data-truncated');
    expect(text.style.webkitLineClamp).toBe('2');
  });

  it('tooltip="always" 沒有截斷也顯示；tooltipContent 取代預設內容', async () => {
    renderInContainer(
      <TextEllipsis data-testid="text" tooltip="always" tooltipContent="補充說明">
        內容
      </TextEllipsis>,
    );
    await userEvent.hover(screen.getByTestId('text'));
    expect(await screen.findByText('補充說明')).toBeVisible();
  });

  it('tooltip="never" 被截斷也不顯示', async () => {
    setSize('text', { clientWidth: 60, scrollWidth: 120 });
    renderInContainer(
      <TextEllipsis data-testid="text" tooltip="never">
        完整的說明文字
      </TextEllipsis>,
    );
    await userEvent.hover(screen.getByTestId('text'));
    expectTooltipHidden('完整的說明文字');
  });

  it('容器寬度低於數字判斷點時換成替代節點，原內容留給螢幕報讀器', () => {
    const onCollapseChange = vi.fn();
    setSize('container', { clientWidth: 300 });
    renderInContainer(
      <TextEllipsis
        data-testid="text"
        collapseAt={200}
        collapsedContent="縮寫"
        onCollapseChange={onCollapseChange}
      >
        完整的說明文字
      </TextEllipsis>,
    );
    const text = screen.getByTestId('text');
    expect(text).not.toHaveAttribute('data-collapsed');

    setSize('container', { clientWidth: 150 });
    resize();
    expect(text).toHaveAttribute('data-collapsed');
    expect(screen.getByText('縮寫')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('完整的說明文字')).toBeInTheDocument();
    expect(onCollapseChange).toHaveBeenLastCalledWith(true);

    setSize('container', { clientWidth: 250 });
    resize();
    expect(text).not.toHaveAttribute('data-collapsed');
    expect(onCollapseChange).toHaveBeenLastCalledWith(false);
  });

  it('尚未布局（容器寬度 0）時不因數字判斷點而收合', () => {
    renderInContainer(
      <TextEllipsis data-testid="text" collapseAt={200} collapsedContent="縮寫">
        內容
      </TextEllipsis>,
    );
    expect(screen.getByTestId('text')).not.toHaveAttribute('data-collapsed');
  });

  it('collapseAt="overflow"：放不下就收合，容器補回不足的寬度才展開', () => {
    setSize('container', { clientWidth: 100 });
    setSize('text', { clientWidth: 100, scrollWidth: 160 });
    renderInContainer(
      <TextEllipsis data-testid="text" collapseAt="overflow" collapsedContent="縮寫">
        完整的說明文字
      </TextEllipsis>,
    );
    const text = screen.getByTestId('text');
    expect(text).toHaveAttribute('data-collapsed');

    // 不足 60px，只變寬 30px 仍維持收合
    setSize('container', { clientWidth: 130 });
    resize();
    expect(text).toHaveAttribute('data-collapsed');

    setSize('container', { clientWidth: 160 });
    setSize('text', { clientWidth: 160, scrollWidth: 160 });
    resize();
    expect(text).not.toHaveAttribute('data-collapsed');
  });

  it('透傳 className 與 ref', () => {
    const ref = { current: null as HTMLSpanElement | null };
    renderInContainer(
      <TextEllipsis ref={ref} className="mt-2" data-testid="text">
        內容
      </TextEllipsis>,
    );
    expect(screen.getByTestId('text')).toHaveClass('mt-2');
    expect(ref.current).toBe(screen.getByTestId('text'));
  });
});
