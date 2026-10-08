import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TableSettings } from './TableSettings';
import type { TableSettingsProps } from './TableSettings';

/** 某一欄的固定按鈕（testid 固定，左右以 data-value 區分）。 */
function pinButton(scope: HTMLElement, side: 'start' | 'end'): HTMLElement {
  const button = scope.querySelector<HTMLElement>(
    `[data-testid="table-settings-pin"][data-value="${side}"]`,
  );
  if (!button) throw new Error(`找不到 table-settings-pin（data-value="${side}"）`);
  return button;
}

const COLUMNS = [
  { id: 'name', label: '名稱' },
  { id: 'email', label: 'Email' },
  { id: 'status', label: '狀態' },
];

const PINNING = { pinnedColumns: { actions: 'end' as const }, stickyHeader: false };
const DEFAULT_VALUE = { order: ['name', 'email', 'status'], hidden: [], ...PINNING };

function renderSettings(overrides: Partial<TableSettingsProps> = {}) {
  const props: TableSettingsProps = {
    columns: COLUMNS,
    fixedColumns: [{ id: 'actions', label: '操作' }],
    value: { order: ['status', 'name', 'email'], hidden: ['email'], ...PINNING },
    defaultValue: DEFAULT_VALUE,
    onChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<TableSettings {...props} />);
  return props;
}

async function openPanel(): Promise<HTMLElement> {
  await userEvent.click(screen.getByTestId('table-settings-trigger'));
  return screen.findByTestId('table-settings-popup');
}

function items(popup: HTMLElement): HTMLElement[] {
  return [...popup.querySelectorAll<HTMLElement>('[data-testid="table-settings-item"]')];
}

function checkboxOf(popup: HTMLElement, id: string): HTMLElement {
  const item = items(popup).find((element) => element.dataset.value === id);
  if (!item) throw new Error(`找不到 ${id}`);
  return within(item).getByRole('checkbox');
}

describe('TableSettings', () => {
  it('依目前的設定列出欄位，隱藏的欄位不勾選', async () => {
    renderSettings();
    const popup = await openPanel();
    expect(items(popup).map((item) => item.dataset.value)).toEqual(['status', 'name', 'email']);
    expect(checkboxOf(popup, 'email')).toHaveAttribute('aria-checked', 'false');
  });

  it('勾選只改草稿，按「套用」才送出並收合', async () => {
    const { onChange } = renderSettings();
    const popup = await openPanel();
    // Base UI 的 checkbox 在 jsdom 取不到無障礙名稱，改點選項文字（同 Checkbox.test.tsx）
    await userEvent.click(within(popup).getByText('Email'));
    await userEvent.click(within(popup).getByText('狀態'));
    expect(onChange).not.toHaveBeenCalled();
    expect(checkboxOf(popup, 'email')).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByTestId('table-settings-submit'));
    expect(onChange).toHaveBeenCalledWith({
      order: ['status', 'name', 'email'],
      hidden: ['status'],
      ...PINNING,
    });
    expect(screen.queryByTestId('table-settings-popup')).not.toBeInTheDocument();
  });

  it('關掉面板就放棄草稿', async () => {
    const { onChange } = renderSettings();
    let popup = await openPanel();
    await userEvent.click(within(popup).getByText('Email'));
    await userEvent.keyboard('{Escape}');

    popup = await openPanel();
    expect(onChange).not.toHaveBeenCalled();
    expect(checkboxOf(popup, 'email')).toHaveAttribute('aria-checked', 'false');
  });

  it('「恢復預設」只改草稿；套用後與預設相同時呼叫 onReset 而不是 onChange', async () => {
    const { onChange, onReset } = renderSettings();
    const popup = await openPanel();
    await userEvent.click(screen.getByTestId('table-settings-reset'));
    expect(items(popup).map((item) => item.dataset.value)).toEqual(['name', 'email', 'status']);
    expect(onReset).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('table-settings-submit'));
    expect(onReset).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('只剩一個顯示中的欄位時不能取消', async () => {
    renderSettings({ value: { order: ['name', 'email'], hidden: ['email'], ...PINNING } });
    const popup = await openPanel();
    expect(checkboxOf(popup, 'name')).toHaveAttribute('aria-disabled', 'true');
  });

  it('每個欄位有一個可用鍵盤操作的拖曳把手', async () => {
    renderSettings();
    const popup = await openPanel();
    const handles = popup.querySelectorAll('[aria-roledescription="sortable"]');
    expect(handles).toHaveLength(3);
    for (const handle of handles) expect(handle).toHaveAttribute('tabindex', '0');
  });

  it('labels 覆寫「恢復預設」「套用」的文字', async () => {
    renderSettings({ labels: { reset: '還原', submit: '儲存' } });
    await openPanel();
    expect(screen.getByTestId('table-settings-reset')).toHaveTextContent('還原');
    expect(screen.getByTestId('table-settings-submit')).toHaveTextContent('儲存');
  });

  it('每一欄可固定在左側或右側，再按一次取消；操作欄在「固定」區塊；都是草稿，按「套用」一起送出', async () => {
    const { onChange } = renderSettings();
    const popup = await openPanel();
    const item = items(popup).find((element) => element.dataset.value === 'name') as HTMLElement;
    await userEvent.click(pinButton(item, 'start'));
    expect(pinButton(item, 'start')).toHaveAttribute('aria-pressed', 'true');

    const actions = within(popup).getByTestId('table-settings-fixed-item');
    // 操作欄預設在 end：按 end 取消、再改到 start
    await userEvent.click(pinButton(actions, 'end'));
    await userEvent.click(pinButton(actions, 'start'));
    await userEvent.click(within(popup).getByTestId('table-settings-sticky-header'));
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('table-settings-submit'));
    expect(onChange).toHaveBeenCalledWith({
      order: ['status', 'name', 'email'],
      hidden: ['email'],
      pinnedColumns: { name: 'start', actions: 'start' },
      stickyHeader: true,
    });
  });
});
