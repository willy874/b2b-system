import type { ColumnDef } from '@tanstack/react-table';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Table } from './index';

interface Row {
  id: string;
  name: string;
}

const data: Row[] = [
  { id: '1', name: '系統管理員' },
  { id: '2', name: '稽核人員' },
];

const columns: Array<ColumnDef<Row, unknown>> = [
  { id: 'name', header: '名稱', cell: ({ row }) => row.original.name },
];

describe('Table', () => {
  it('渲染表頭與資料列', () => {
    render(<Table data={data} columns={columns} getRowId={(row) => row.id} />);
    expect(screen.getByRole('columnheader', { name: '名稱' })).toBeInTheDocument();
    expect(screen.getAllByTestId('table-row')).toHaveLength(2);
  });

  it('loading 時顯示骨架並標記 aria-busy', () => {
    render(<Table data={[]} columns={columns} loading />);
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
  });

  it('沒有資料時顯示空狀態', () => {
    render(<Table data={[]} columns={columns} emptyTitle="沒有角色" />);
    expect(screen.getByTestId('table-empty')).toHaveTextContent('沒有角色');
  });

  it('點擊可排序的表頭會回報欄位與方向', async () => {
    const onSortingChange = vi.fn();
    render(
      <Table
        data={data}
        columns={columns}
        sorting={{ sortBy: 'name', sortOrder: 'asc' }}
        onSortingChange={onSortingChange}
      />,
    );
    await userEvent.click(screen.getByRole('columnheader', { name: /名稱/ }));
    expect(onSortingChange).toHaveBeenCalledWith('name', 'desc');
  });

  it('排序中的欄位標記 aria-sort', () => {
    render(
      <Table
        data={data}
        columns={columns}
        sorting={{ sortBy: 'name', sortOrder: 'asc' }}
        onSortingChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /名稱/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('雙擊列會開啟詳情', async () => {
    const onRowDoubleClick = vi.fn();
    render(
      <Table
        data={data}
        columns={columns}
        getRowId={(row) => row.id}
        onRowDoubleClick={onRowDoubleClick}
      />,
    );
    await userEvent.dblClick(screen.getAllByTestId('table-row')[0] as HTMLElement);
    expect(onRowDoubleClick).toHaveBeenCalledWith(data[0]);
  });

  it('尚未進入選取模式時，單擊列身不做任何事', async () => {
    const onRowSelectionChange = vi.fn();
    render(
      <Table
        data={data}
        columns={columns}
        getRowId={(row) => row.id}
        rowSelection={{}}
        onRowSelectionChange={onRowSelectionChange}
      />,
    );
    await userEvent.click(screen.getAllByTestId('table-row')[0] as HTMLElement);
    expect(onRowSelectionChange).not.toHaveBeenCalled();
  });

  it('已進入選取模式後，單擊列身切換選取', async () => {
    const onRowSelectionChange = vi.fn();
    render(
      <Table
        data={data}
        columns={columns}
        getRowId={(row) => row.id}
        rowSelection={{ '2': true }}
        onRowSelectionChange={onRowSelectionChange}
      />,
    );
    await userEvent.click(screen.getAllByTestId('table-row')[0] as HTMLElement);
    expect(onRowSelectionChange).toHaveBeenCalledWith({ '1': true, '2': true });
  });
});
