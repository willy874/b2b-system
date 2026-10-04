import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { TableColumnDef } from '@/components/Table';
import { AppError } from '@/core/errors';
import type { SortEntry } from '@/shared/constants';
import { initTestI18n } from '@/test/i18n';

import type { FilterBarProps } from './FilterBar';
import { RichTable } from './RichTable';
import { TABLE_SEARCH_DEBOUNCE_MS } from './TableSearch';

interface Row {
  id: string;
  name: string;
}

// type（而非 interface）才能指派給 Record<string, unknown>
type Filters = {
  keyword?: string;
  status?: 'active' | 'locked';
  sort?: Array<SortEntry<'name'>>;
};

const columns: Array<TableColumnDef<Row>> = [
  { id: 'name', header: 'Name', cell: ({ row }) => row.original.name },
];
const rows: Row[] = [{ id: '1', name: 'Alice' }];

function statusFilters(value: Filters, onSubmit = vi.fn()): FilterBarProps<Filters> {
  return {
    value,
    defaultValue: { keyword: undefined, status: undefined, sort: [] },
    onSubmit,
    fields: [
      {
        type: 'select',
        key: 'status',
        label: '狀態',
        options: [
          { value: 'active', label: '啟用' },
          { value: 'locked', label: '鎖定' },
        ],
      },
      { type: 'sort', key: 'sort', label: '排序', options: [{ value: 'name', label: '名稱' }] },
    ],
  };
}

beforeAll(() => initTestI18n());
afterEach(() => vi.useRealTimers());

describe('RichTable 的查詢失敗', () => {
  it('沒有資料又失敗時顯示錯誤與重試，不顯示「沒有資料」', async () => {
    const onRetry = vi.fn();
    render(
      <RichTable
        data={[]}
        columns={columns}
        error={new AppError('INTERNAL_ERROR', 500)}
        onRetry={onRetry}
      />,
    );
    const error = screen.getByTestId('rich-table-error');
    expect(error).toHaveTextContent('伺服器發生錯誤');
    expect(screen.queryByTestId('table-empty')).not.toBeInTheDocument();
    await userEvent.click(within(error).getByTestId('query-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('有舊資料時保留表格，上方提示沒有更新成功', () => {
    render(
      <RichTable
        data={rows}
        columns={columns}
        error={new AppError('RATE_LIMITED', 429)}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByTestId('rich-table-stale')).toHaveAttribute('role', 'alert');
  });
});

describe('RichTable 的篩選狀態', () => {
  it('套用中的條件以 Chip 列出，移除只清該條件', async () => {
    const onSubmit = vi.fn();
    render(
      <RichTable
        data={rows}
        columns={columns}
        filters={statusFilters(
          { status: 'locked', sort: [{ sort: 'name', order: 'asc' }] },
          onSubmit,
        )}
      />,
    );
    const chip = screen.getByTestId('active-filter');
    expect(chip).toHaveTextContent('狀態：鎖定');
    // 排序不是篩選，不列成 Chip
    expect(screen.getAllByTestId('active-filter')).toHaveLength(1);
    await userEvent.click(within(chip).getByRole('button', { name: '移除篩選條件「狀態：鎖定」' }));
    expect(onSubmit).toHaveBeenCalledWith({
      status: undefined,
      sort: [{ sort: 'name', order: 'asc' }],
    });
  });

  it('有篩選但沒有結果：說明「沒有符合條件」並可一鍵清除（保留排序）', async () => {
    const onSubmit = vi.fn();
    const sort = [{ sort: 'name' as const, order: 'desc' as const }];
    render(
      <RichTable
        data={[]}
        columns={columns}
        filters={statusFilters({ status: 'locked', sort }, onSubmit)}
      />,
    );
    expect(screen.getByTestId('table-empty')).toHaveTextContent('沒有符合條件的結果');
    await userEvent.click(screen.getByTestId('rich-table-clear-filters'));
    expect(onSubmit).toHaveBeenCalledWith({ keyword: undefined, status: undefined, sort });
  });

  it('沒有篩選時的空狀態仍是「沒有資料」', () => {
    render(<RichTable data={[]} columns={columns} filters={statusFilters({ sort: [] })} />);
    expect(screen.getByTestId('table-empty')).toHaveTextContent('沒有資料');
    expect(screen.queryByTestId('rich-table-clear-filters')).not.toBeInTheDocument();
  });

  it('常駐搜尋框：停止輸入後才送出，空白視為清除', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <RichTable
        data={rows}
        columns={columns}
        search={{ value: undefined, onChange, placeholder: '搜尋使用者' }}
      />,
    );
    const input = screen.getByRole('searchbox', { name: '搜尋使用者' });
    fireEvent.change(input, { target: { value: 'ali' } });
    fireEvent.change(input, { target: { value: 'alic' } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(TABLE_SEARCH_DEBOUNCE_MS));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('alic');
  });
});

describe('RichTable 的分頁', () => {
  it('摘要用千分位與語系文案', () => {
    render(
      <RichTable
        data={rows}
        columns={columns}
        pagination={{ offset: 20, limit: 20, total: 1200, onChange: vi.fn() }}
      />,
    );
    expect(screen.getByTestId('pagination-summary')).toHaveTextContent('第 21–40 筆，共 1,200 筆');
  });

  it('刪到最後一頁沒有資料時退回最後一頁', () => {
    const onChange = vi.fn();
    render(
      <RichTable
        data={[]}
        columns={columns}
        pagination={{ offset: 40, limit: 20, total: 40, onChange }}
      />,
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ offset: 20, limit: 20 });
  });

  it('查詢中或總數為 0 時不動分頁', () => {
    const onChange = vi.fn();
    render(
      <RichTable
        data={[]}
        columns={columns}
        loading
        pagination={{ offset: 40, limit: 20, total: 40, onChange }}
      />,
    );
    render(
      <RichTable
        data={[]}
        columns={columns}
        pagination={{ offset: 0, limit: 20, total: 0, onChange }}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
