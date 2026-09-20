import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Tabs, TabsPanel } from './index';

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
    await userEvent.click(screen.getByTestId('tab-permission'));
    expect(onValueChange).toHaveBeenCalledWith('permission');
  });

  it('方向鍵在分頁之間移動焦點（roving tabindex）', async () => {
    render(<Tabs value="basic" tabs={tabs} />);
    screen.getByTestId('tab-basic').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByTestId('tab-permission')).toHaveFocus();
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
