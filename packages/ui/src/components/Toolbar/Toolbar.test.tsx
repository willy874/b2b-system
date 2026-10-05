import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeLayout } from '../../testing/fakeLayout';
import { Icon } from '../Icon';
import { TooltipProvider } from '../Tooltip';
import { Toolbar } from './index';
import type { ToolbarItem, ToolbarProps } from './index';

let layout: ReturnType<typeof installFakeLayout>;
const onUndo = vi.fn();
const onRedo = vi.fn();
const onDelete = vi.fn();

const ITEMS: ToolbarItem[] = [
  { key: 'undo', label: '復原', icon: <Icon name="undo" size={16} />, onClick: onUndo },
  { key: 'redo', label: '重做', icon: <Icon name="redo" size={16} />, onClick: onRedo },
  { key: 'delete', label: '刪除', variant: 'danger', onClick: onDelete, align: 'end' },
];

/** 以固定的 `data-testid` ＋ `data-value` 找按鈕（docs/conventions/06-literal-strings.md §3.3）。 */
function queryItem(key: string) {
  return document.querySelector<HTMLElement>(`[data-testid="toolbar-item"][data-value="${key}"]`);
}

beforeEach(() => {
  layout = installFakeLayout();
  layout.setSize('toolbar-item', { width: 80 });
  layout.setSize('toolbar-more', { width: 36 });
});

afterEach(() => {
  layout.restore();
  vi.clearAllMocks();
});

function renderToolbar(props: Partial<ToolbarProps> = {}) {
  return render(
    <TooltipProvider delay={0}>
      <Toolbar data-testid="toolbar" aria-label="編輯" items={ITEMS} {...props} />
    </TooltipProvider>,
  );
}

describe('Toolbar', () => {
  it('以 toolbar 角色曝露，寬度足夠時全部顯示、沒有「更多」', () => {
    layout.setSize('toolbar', { clientWidth: 400 });
    renderToolbar();
    expect(screen.getByRole('toolbar', { name: '編輯' })).toBeInTheDocument();
    expect(screen.getAllByTestId('toolbar-item')).toHaveLength(3);
    expect(screen.queryByTestId('toolbar-more')).not.toBeInTheDocument();
  });

  it('第一個 end 項目推到右側', () => {
    layout.setSize('toolbar', { clientWidth: 400 });
    renderToolbar();
    expect(queryItem('delete')).toHaveAttribute('data-push');
    expect(queryItem('undo')).not.toHaveAttribute('data-push');
  });

  it('放不下的按鈕從尾端收進下拉，選項觸發原本的 onClick', async () => {
    // 80 + 80 + 36 ＝ 196
    layout.setSize('toolbar', { clientWidth: 200 });
    renderToolbar();
    expect(queryItem('undo')).toBeInTheDocument();
    expect(queryItem('redo')).toBeInTheDocument();
    expect(queryItem('delete')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '更多' }));
    const option = await screen.findByRole('menuitem', { name: '刪除' });
    expect(option).toHaveAttribute('data-tone', 'danger');
    await userEvent.click(option);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('容器縮放時重新計算', () => {
    layout.setSize('toolbar', { clientWidth: 400 });
    renderToolbar();
    layout.setSize('toolbar', { clientWidth: 120 });
    layout.resize();
    expect(screen.getAllByTestId('toolbar-item')).toHaveLength(1);
    expect(screen.getByTestId('toolbar-more')).toBeInTheDocument();
  });

  it('iconOnly 為數字時，寬度小於它就只顯示圖示（label 成為無障礙名稱）', () => {
    layout.setSize('toolbar', { clientWidth: 300 });
    renderToolbar({ iconOnly: 360 });
    expect(queryItem('undo')).toHaveAccessibleName('復原');
    expect(queryItem('undo')).not.toHaveTextContent('復原');
    // 沒有圖示的項目仍顯示文字
    expect(queryItem('delete')).toHaveTextContent('刪除');
  });

  it('方向鍵在按鈕之間移動焦點，頭尾循環', async () => {
    layout.setSize('toolbar', { clientWidth: 400 });
    renderToolbar();
    queryItem('undo')?.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(queryItem('redo')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(queryItem('delete')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(queryItem('undo')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(queryItem('delete')).toHaveFocus();
  });
});
