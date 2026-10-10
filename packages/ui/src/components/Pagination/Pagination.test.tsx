import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ComponentLabelsContext, DEFAULT_COMPONENT_LABELS } from '../labels';
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
    await userEvent.click(screen.getByRole('combobox', { name: '每頁筆數' }));
    await userEvent.click(await screen.findByRole('option', { name: '50' }));
    expect(onChange).toHaveBeenCalledWith({ offset: 0, limit: 50 });
  });

  it('第一頁／最後一頁一步到位', async () => {
    const onChange = vi.fn();
    render(<Pagination offset={40} limit={20} total={1200} onChange={onChange} />);
    await userEvent.click(screen.getByTestId('pagination-last'));
    expect(onChange).toHaveBeenLastCalledWith({ offset: 1180, limit: 20 });
    await userEvent.click(screen.getByTestId('pagination-first'));
    expect(onChange).toHaveBeenLastCalledWith({ offset: 0, limit: 20 });
  });

  it('輸入頁碼按 Enter 跳頁，超出範圍時夾到最後一頁', async () => {
    const onChange = vi.fn();
    render(<Pagination offset={0} limit={20} total={1200} onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: '頁碼' });
    await userEvent.clear(input);
    await userEvent.type(input, '30{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ offset: 580, limit: 20 });
    await userEvent.clear(input);
    await userEvent.type(input, '999{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ offset: 1180, limit: 20 });
  });

  it('導覽與每頁筆數的無障礙名稱跟著 ComponentLabelsContext 換語系', () => {
    render(
      <ComponentLabelsContext
        value={{
          ...DEFAULT_COMPONENT_LABELS,
          paginationNav: 'Pagination',
          paginationPageSize: 'Rows per page',
        }}
      >
        <Pagination offset={0} limit={20} total={10} onChange={vi.fn()} />
      </ComponentLabelsContext>,
    );
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toBeInTheDocument();
  });

  it('maxOffset：頁數、最後一頁與頁碼輸入都不超過伺服器接受的 offset', async () => {
    const onChange = vi.fn();
    render(
      <Pagination offset={0} limit={50} total={10_100} maxOffset={10_000} onChange={onChange} />,
    );
    await userEvent.click(screen.getByTestId('pagination-last'));
    expect(onChange).toHaveBeenLastCalledWith({ offset: 10_000, limit: 50 });

    const input = screen.getByRole('spinbutton', { name: '頁碼' });
    await userEvent.clear(input);
    await userEvent.type(input, '999{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ offset: 10_000, limit: 50 });
  });

  it('maxOffset：停在可到達的最後一頁時下一頁是 disabled', () => {
    render(
      <Pagination
        offset={10_000}
        limit={25}
        total={10_100}
        maxOffset={10_000}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('pagination-next')).toBeDisabled();
  });

  it('沒有資料時顯示 0', () => {
    render(<Pagination offset={0} limit={20} total={0} onChange={vi.fn()} />);
    expect(screen.getByTestId('pagination-summary')).toHaveTextContent('0-0 / 0');
  });
});
