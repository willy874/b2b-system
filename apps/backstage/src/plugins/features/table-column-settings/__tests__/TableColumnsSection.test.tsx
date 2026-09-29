import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { registerPreferenceTable, resetPreferenceRegistry } from '@/core/preference';
import { useTableColumnSettingsStore } from '@/core/store';

import { TableColumnsSection } from '../TableColumnsSection';

const STORAGE_KEY = 'b2b-system:table-column-settings:tables';

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
    useTableColumnSettingsStore.setState({ settings: {}, pinnedRows: {} });
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
    // 工具欄排在最前面：勾選欄固定在 start、釘選欄預設隱藏
    expect(items.map((item) => item.dataset.value)).toEqual([
      '__select',
      '__pin',
      'name',
      'email',
      'status',
    ]);
    expect(items[0]).toHaveAttribute('data-pin', 'start');
    expect(items[1]).toHaveAttribute('data-hidden');
    expect(items[4]).toHaveAttribute('data-hidden');
  });

  it('反映存下來的設定（列表上改的也會在這裡看到）', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        'user-list': { order: ['__pin', 'email', 'name', 'status'], hidden: [] },
      }),
    );
    render(<TableColumnsSection />);
    const items = within(card('user-list')).getAllByRole('listitem');
    // 存設定時還沒有勾選欄：新加的工具欄插在最前面，其餘照存下來的順序
    expect(items.map((item) => item.dataset.value)).toEqual([
      '__select',
      '__pin',
      'email',
      'name',
      'status',
    ]);
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
      'user-list': {
        order: ['__select', '__pin', 'name', 'email', 'status'],
        hidden: ['__pin', 'status', 'email'],
        pinnedColumns: { __select: 'start', actions: 'end' },
        stickyHeader: false,
      },
    });
    const emailItem = within(card('user-list'))
      .getAllByRole('listitem')
      .find((item) => item.dataset.value === 'email');
    expect(emailItem).toHaveAttribute('data-hidden');
  });

  it('卡片摘要列出固定的欄位數、固定表頭與釘選的列，並可清除釘選列', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        'user-list': {
          order: ['name', 'email', 'status'],
          hidden: [],
          pinnedColumns: { name: 'start', actions: 'end' },
          stickyHeader: true,
        },
      }),
    );
    // 掛載時會從 localStorage 重讀，所以直接寫進 localStorage
    localStorage.setItem(
      'b2b-system:table-column-settings:pinnedRows',
      JSON.stringify({ 'user-list': [{ id: '1', side: 'top', row: {} }] }),
    );
    render(<TableColumnsSection />);
    const summary = within(card('user-list')).getByTestId('table-columns-pinning');
    const values = [...summary.querySelectorAll<HTMLElement>('[data-value]')].map(
      (element) => element.dataset.value,
    );
    expect(values).toEqual(['columns', 'stickyHeader', 'rows']);
    const nameItem = within(card('user-list'))
      .getAllByRole('listitem')
      .find((item) => item.dataset.value === 'name');
    expect(nameItem).toHaveAttribute('data-pin', 'start');

    await userEvent.click(within(card('user-list')).getByTestId('table-columns-clear-pinned-rows'));
    expect(useTableColumnSettingsStore.getState().pinnedRows).toEqual({});
  });
});
