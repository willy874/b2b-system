import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { registerPreferenceTable, resetPreferenceRegistry } from '@/core/preference';
import { useTableColumnSettingsStore } from '@/core/store';

import { TableColumnsSection } from '../TableColumnsSection';

const STORAGE_KEY = 'game-editor:table-column-settings:tables';

function card(tableId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-testid="table-columns-card"][data-value="${tableId}"]`,
  );
  if (!element) throw new Error(`找不到 table-columns-card（data-value="${tableId}"）`);
  return element;
}

describe('TableColumnsSection（偏好頁的表格欄位分頁）', () => {
  beforeEach(() => {
    localStorage.clear();
    useTableColumnSettingsStore.setState({ settings: {} });
    resetPreferenceRegistry();
    registerPreferenceTable({
      id: 'user-list',
      labelI18nKey: 'user.list.title',
      columnLabelKeys: { name: 'name', email: 'email', status: 'status' },
      defaultHidden: ['status'],
    });
  });

  it('每張登記的表一張卡片，依預設順序列出欄位並標出預設隱藏的欄位', () => {
    render(<TableColumnsSection />);
    const items = within(card('user-list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('name'),
      expect.stringContaining('email'),
      expect.stringContaining('status'),
    ]);
    expect(items[2]).toHaveAttribute('data-hidden');
  });

  it('反映存下來的設定（列表上改的也會在這裡看到）', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'user-list': { order: ['email', 'name', 'status'], hidden: [] } }),
    );
    render(<TableColumnsSection />);
    const items = within(card('user-list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('email');
    expect(items.some((item) => item.hasAttribute('data-hidden'))).toBe(false);
  });

  it('在卡片上用齒輪調整後按「套用」，寫入同一份設定', async () => {
    render(<TableColumnsSection />);
    await userEvent.click(within(card('user-list')).getByTestId('table-settings-trigger'));
    const popup = await screen.findByTestId('table-settings-popup');
    // Base UI 的 checkbox 在 jsdom 取不到無障礙名稱，改點選項文字（同 Checkbox.test.tsx）
    await userEvent.click(within(popup).getByText('email'));
    await userEvent.click(screen.getByTestId('table-settings-submit'));

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      'user-list': { order: ['name', 'email', 'status'], hidden: ['status', 'email'] },
    });
    expect(within(card('user-list')).getAllByRole('listitem')[1]).toHaveAttribute('data-hidden');
  });
});
