import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeLayout } from '../../testing/fakeLayout';
import { Tabs, TabsPanel } from './index';

/** 以固定的 `data-testid` ＋ `data-value` 找元素（docs/coding-standards/06-literal-strings.md §3.3）。 */
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

describe('Tabs（放不下時收進「更多」下拉）', () => {
  const manyTabs = [
    { value: 'a', label: '甲' },
    { value: 'b', label: '乙' },
    { value: 'c', label: '丙' },
    { value: 'd', label: '丁' },
  ];
  let layout: ReturnType<typeof installFakeLayout>;

  beforeEach(() => {
    layout = installFakeLayout();
    layout.setSize('tab', { width: 80 });
    layout.setSize('tabs-more', { width: 60 });
  });

  afterEach(() => layout.restore());

  function renderTabs(value: string, onValueChange = vi.fn()) {
    return render(
      <Tabs
        value={value}
        tabs={manyTabs}
        onValueChange={onValueChange}
        testIds={{ bar: 'tabs-bar' }}
      />,
    );
  }

  it('寬度足夠時全部顯示，沒有「更多」', () => {
    layout.setSize('tabs-bar', { clientWidth: 400 });
    renderTabs('a');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByTestId('tabs-more')).not.toBeInTheDocument();
  });

  it('放不下的分頁收進下拉，選項會切換分頁', async () => {
    // 80 + 80 + 60 ＝ 220
    layout.setSize('tabs-bar', { clientWidth: 230 });
    const onValueChange = vi.fn();
    renderTabs('a', onValueChange);
    expect(screen.getAllByRole('tab').map((tab) => tab.dataset.value)).toEqual(['a', 'b']);

    await userEvent.click(screen.getByTestId('tabs-more'));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['丙', '丁']);
    await userEvent.click(screen.getByRole('menuitem', { name: '丁' }));
    expect(onValueChange).toHaveBeenCalledWith('d');
  });

  it('選取中的分頁被收起時改佔最後一個可見位置', () => {
    layout.setSize('tabs-bar', { clientWidth: 230 });
    renderTabs('d');
    expect(screen.getAllByRole('tab').map((tab) => tab.dataset.value)).toEqual(['a', 'd']);
    expect(screen.getByRole('tab', { name: '丁' })).toHaveAttribute('aria-selected', 'true');
  });

  it('容器變寬時展開回分頁', () => {
    layout.setSize('tabs-bar', { clientWidth: 230 });
    renderTabs('a');
    layout.setSize('tabs-bar', { clientWidth: 400 });
    layout.resize();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByTestId('tabs-more')).not.toBeInTheDocument();
  });
});
