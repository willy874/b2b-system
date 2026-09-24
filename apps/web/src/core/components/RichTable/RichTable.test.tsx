import type { ColumnDef } from '@tanstack/react-table';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RichTable } from './RichTable';

interface Row {
  id: string;
  name: string;
}

const columns: Array<ColumnDef<Row, unknown>> = [
  { id: 'name', header: 'Name', cell: ({ row }) => row.original.name },
];

const rows: Row[] = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

describe('RichTable', () => {
  it('渲染資料列，testid 落在最外層容器', () => {
    render(<RichTable data={rows} columns={columns} data-testid="sample-table" />);
    const root = screen.getByTestId('sample-table');
    expect(within(root).getByRole('table')).toBeInTheDocument();
    expect(within(root).getByText('Alice')).toBeInTheDocument();
    expect(within(root).getByText('Bob')).toBeInTheDocument();
  });

  it('沒有提供 pagination 時不顯示分頁列', () => {
    render(<RichTable data={rows} columns={columns} />);
    expect(screen.queryByRole('navigation', { name: 'pagination' })).not.toBeInTheDocument();
  });

  it('提供 pagination 時顯示分頁列與目前範圍', () => {
    render(
      <RichTable
        data={rows}
        columns={columns}
        pagination={{ offset: 20, limit: 20, total: 137, onChange: vi.fn() }}
      />,
    );
    expect(screen.getByTestId('pagination-summary')).toHaveTextContent('21-40 / 137');
  });

  it('換頁時回報新的 offset', async () => {
    const onChange = vi.fn();
    render(
      <RichTable
        data={rows}
        columns={columns}
        pagination={{ offset: 0, limit: 20, total: 137, onChange }}
      />,
    );
    await userEvent.click(screen.getByTestId('pagination-next'));
    expect(onChange).toHaveBeenCalledWith({ offset: 20, limit: 20 });
  });

  it('沒有資料時顯示空狀態，傳入的 emptyTitle 優先於預設文案', () => {
    render(<RichTable data={[]} columns={columns} emptyTitle="查無使用者" />);
    expect(screen.getByTestId('table-empty')).toHaveTextContent('查無使用者');
  });
});
