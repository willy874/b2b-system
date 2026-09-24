import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Select } from './index';

const options = [
  { value: 'active', label: '啟用' },
  { value: 'inactive', label: '停用' },
  { value: 'locked', label: '鎖定', disabled: true },
];

describe('Select', () => {
  it('點擊開啟並選取', async () => {
    const onValueChange = vi.fn();
    render(<Select options={options} onValueChange={onValueChange} aria-label="狀態" />);
    await userEvent.click(screen.getByRole('combobox', { name: '狀態' }));
    await userEvent.click(await screen.findByRole('option', { name: '停用' }));
    expect(onValueChange).toHaveBeenCalledWith('inactive');
  });

  it('鍵盤可開啟與選取', async () => {
    const onValueChange = vi.fn();
    render(<Select options={options} onValueChange={onValueChange} aria-label="狀態" />);
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('option', { name: '啟用' })).toBeVisible();
  });

  it('disabled 時無法開啟', async () => {
    render(<Select options={options} disabled aria-label="狀態" />);
    await userEvent.click(screen.getByRole('combobox', { name: '狀態' }));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('顯示已選項目的標籤', () => {
    render(<Select options={options} value="inactive" aria-label="狀態" />);
    expect(screen.getByRole('combobox', { name: '狀態' })).toHaveTextContent('停用');
  });

  it('invalid 反映在 aria-invalid', () => {
    render(<Select options={options} invalid aria-label="狀態" />);
    expect(screen.getByRole('combobox', { name: '狀態' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('尺寸以 data-size 屬性表現在觸發按鈕上', () => {
    render(<Select options={options} size="sm" aria-label="狀態" />);
    expect(screen.getByRole('combobox', { name: '狀態' })).toHaveAttribute('data-size', 'sm');
  });
});
