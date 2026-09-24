import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Combobox } from './index';

/** 以固定的 `data-testid` ＋ `data-value` 找元素（docs/conventions/06-literal-strings.md §3.3）。 */
function queryItem(value: string) {
  return document.querySelector<HTMLElement>(
    `[data-testid="combobox-item"][data-value="${value}"]`,
  );
}

function getItem(value: string) {
  const element = queryItem(value);
  if (!element) throw new Error(`找不到 combobox-item（data-value="${value}"）`);
  return element;
}

const findItem = (value: string) => waitFor(() => getItem(value));

const options = [
  { value: 'admin', label: '系統管理員' },
  { value: 'auditor', label: '稽核人員' },
  { value: 'member', label: '一般成員', disabled: true },
];

describe('Combobox', () => {
  it('輸入可過濾選項', async () => {
    render(<Combobox options={options} aria-label="角色" placeholder="搜尋角色" />);
    await userEvent.click(screen.getByRole('combobox', { name: '角色' }));
    await userEvent.keyboard('稽核');
    expect(await findItem('auditor')).toBeInTheDocument();
    expect(queryItem('admin')).not.toBeInTheDocument();
  });

  it('選取後回傳 value', async () => {
    const onValueChange = vi.fn();
    render(<Combobox options={options} onValueChange={onValueChange} aria-label="角色" />);
    await userEvent.click(screen.getByRole('combobox', { name: '角色' }));
    await userEvent.click(await findItem('admin'));
    expect(onValueChange).toHaveBeenCalled();
  });

  it('鍵盤可以開啟清單並選取', async () => {
    const onValueChange = vi.fn();
    render(<Combobox options={options} onValueChange={onValueChange} aria-label="角色" />);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    expect(await findItem('admin')).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalled();
  });

  it('disabled 時不可輸入', async () => {
    render(<Combobox disabled options={options} aria-label="角色" />);
    expect(screen.getByRole('combobox', { name: '角色' })).toBeDisabled();
  });

  it('沒有符合項目時顯示空狀態', async () => {
    render(<Combobox options={options} aria-label="角色" emptyMessage="查無資料" />);
    await userEvent.click(screen.getByRole('combobox', { name: '角色' }));
    await userEvent.keyboard('zzzz');
    expect(await screen.findByText('查無資料')).toBeVisible();
  });
});
