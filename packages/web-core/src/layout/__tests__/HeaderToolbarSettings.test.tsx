import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { useHeaderToolbarStore } from '../../store';
import { registerHeaderTool, resetHeaderToolRegistry } from '../../toolbar';
import { HeaderToolbarSettings } from '../HeaderToolbarSettings';

const STORAGE_KEY = 'b2b-system:preference:headerToolbar';

function itemKeys(): Array<string | undefined> {
  return screen.getAllByTestId('header-toolbar-item').map((item) => item.dataset.value);
}

describe('HeaderToolbarSettings（偏好頁的頂列工具）', () => {
  beforeEach(() => {
    localStorage.clear();
    useHeaderToolbarStore.setState({ settings: null });
    resetHeaderToolRegistry();
    registerHeaderTool({
      key: 'language',
      order: 100,
      labelI18nKey: 'language.label',
      icon: 'globe',
      Component: () => null,
    });
    registerHeaderTool({
      key: 'theme',
      order: 200,
      labelI18nKey: 'theme.label',
      icon: 'sun',
      Component: () => null,
    });
  });

  it('列出登記的工具，預設全部開啟、沒有恢復預設按鈕', () => {
    render(<HeaderToolbarSettings />);
    expect(itemKeys()).toEqual(['language', 'theme']);
    for (const toggle of screen.getAllByTestId('header-toolbar-toggle')) {
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    }
    expect(screen.queryByTestId('header-toolbar-reset')).not.toBeInTheDocument();
  });

  it('關掉一個工具會存進本機，恢復預設後清掉設定', async () => {
    const user = userEvent.setup();
    render(<HeaderToolbarSettings />);

    await user.click(screen.getAllByTestId('header-toolbar-toggle')[1]!);
    expect(useHeaderToolbarStore.getState().settings).toEqual({
      order: ['language', 'theme'],
      hidden: ['theme'],
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual({
      order: ['language', 'theme'],
      hidden: ['theme'],
    });
    expect(screen.getAllByTestId('header-toolbar-item')[1]).toHaveAttribute('data-hidden');

    await user.click(screen.getByTestId('header-toolbar-reset'));
    expect(useHeaderToolbarStore.getState().settings).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // 拖曳本身靠版面座標，jsdom 量不到，改在瀏覽器驗；這裡驗排序結果的呈現
  it('照存下來的順序列出', () => {
    useHeaderToolbarStore.setState({ settings: { order: ['theme', 'language'], hidden: [] } });
    render(<HeaderToolbarSettings />);
    expect(itemKeys()).toEqual(['theme', 'language']);
    expect(screen.getByTestId('header-toolbar-reset')).toBeInTheDocument();
  });
});
