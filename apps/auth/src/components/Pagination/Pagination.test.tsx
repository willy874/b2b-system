import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Pagination } from './index';

describe('Pagination', () => {
  it('顯示目前範圍與總數', () => {
    render(<Pagination offset={20} limit={20} total={137} onChange={vi.fn()} />);
    expect(screen.getByTestId('pagination-summary')).toHaveTextContent('21-40 / 137');
  });

  it('第一頁時上一頁是 disabled', () => {
    render(<Pagination offset={0} limit={20} total={137} onChange={vi.fn()} />);
    expect(screen.getByTestId('pagination-prev')).toBeDisabled();
    expect(screen.getByTestId('pagination-next')).toBeEnabled();
  });

  it('最後一頁時下一頁是 disabled', () => {
    render(<Pagination offset={120} limit={20} total={137} onChange={vi.fn()} />);
    expect(screen.getByTestId('pagination-next')).toBeDisabled();
  });

  it('換頁會回傳新的 offset', async () => {
    const onChange = vi.fn();
    render(<Pagination offset={0} limit={20} total={137} onChange={onChange} />);
    await userEvent.click(screen.getByTestId('pagination-next'));
    expect(onChange).toHaveBeenCalledWith({ offset: 20, limit: 20 });
  });

  it('改每頁筆數會回到第一頁', async () => {
    const onChange = vi.fn();
    render(<Pagination offset={40} limit={20} total={137} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'page size' }));
    await userEvent.click(await screen.findByRole('option', { name: '50' }));
    expect(onChange).toHaveBeenCalledWith({ offset: 0, limit: 50 });
  });

  it('沒有資料時顯示 0', () => {
    render(<Pagination offset={0} limit={20} total={0} onChange={vi.fn()} />);
    expect(screen.getByTestId('pagination-summary')).toHaveTextContent('0-0 / 0');
  });
});
