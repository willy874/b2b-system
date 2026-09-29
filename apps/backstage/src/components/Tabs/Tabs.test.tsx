import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Tabs, TabsPanel } from './index';

/** 以固定的 `data-testid` ＋ `data-value` 找元素（docs/conventions/06-literal-strings.md §3.3）。 */
function queryTab(value: string) {
  return document.querySelector<HTMLElement>(`[data-testid="tab"][data-value="${value}"]`);
}

function getTab(value: string) {
  const element = queryTab(value);
  if (!element) throw new Error(`找不到 tab（data-value="${value}"）`);
  return element;
}

const tabs = [
  { value: 'basic', label: '基本資料' },
  { value: 'permission', label: '權限' },
];

describe('Tabs', () => {
  it('以 tablist 角色曝露，選取的分頁有 aria-selected', () => {
    render(<Tabs value="basic" tabs={tabs} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '基本資料' })).toHaveAttribute('aria-selected', 'true');
  });

  it('點擊切換分頁', async () => {
    const onValueChange = vi.fn();
    render(<Tabs value="basic" tabs={tabs} onValueChange={onValueChange} />);
    await userEvent.click(getTab('permission'));
    expect(onValueChange).toHaveBeenCalledWith('permission');
  });

  it('方向鍵在分頁之間移動焦點（roving tabindex）', async () => {
    render(<Tabs value="basic" tabs={tabs} />);
    getTab('basic').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(getTab('permission')).toHaveFocus();
  });

  it('可渲染對應的內容面板', () => {
    render(
      <Tabs value="basic" tabs={tabs}>
        <TabsPanel value="basic">基本內容</TabsPanel>
        <TabsPanel value="permission">權限內容</TabsPanel>
      </Tabs>,
    );
    expect(screen.getByText('基本內容')).toBeVisible();
  });
});
