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

  it('點擊升冪中的表頭換成降冪', async () => {
    const onSortingChange = vi.fn();
    render(
      <Table
        data={data}
        columns={columns}
        sorting={[{ sortBy: 'name', sortOrder: 'asc' }]}
        onSortingChange={onSortingChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '名稱' }));
    expect(onSortingChange).toHaveBeenCalledWith([{ sortBy: 'name', sortOrder: 'desc' }]);
  });

  it('點擊降冪中的表頭取消排序', async () => {
    const onSortingChange = vi.fn();
    render(
      <Table
        data={data}
        columns={columns}
        sorting={[{ sortBy: 'name', sortOrder: 'desc' }]}
        onSortingChange={onSortingChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '名稱' }));
    expect(onSortingChange).toHaveBeenCalledWith([]);
  });

  it('未排序的欄位從升冪開始', async () => {
    const onSortingChange = vi.fn();
    render(<Table data={data} columns={columns} onSortingChange={onSortingChange} />);
    await userEvent.click(screen.getByRole('button', { name: '名稱' }));
    expect(onSortingChange).toHaveBeenCalledWith([{ sortBy: 'name', sortOrder: 'asc' }]);
  });

  it('排序中的欄位顯示優先順序數字，未排序的欄位不顯示', () => {
    render(
      <Table
        data={data}
        columns={[
          ...columns,
          { id: 'id', header: 'ID', cell: ({ row }) => row.original.id },
          { id: 'extra', header: '其他', cell: () => '-' },
        ]}
        sorting={[
          { sortBy: 'id', sortOrder: 'desc' },
          { sortBy: 'name', sortOrder: 'asc' },
        ]}
        onSortingChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /名稱/ })).toHaveTextContent('名稱2');
    expect(screen.getByRole('columnheader', { name: /ID/ })).toHaveTextContent('ID1');
    expect(screen.getByRole('columnheader', { name: /其他/ })).toHaveTextContent(/^其他$/);
  });

  it('可排序的表頭可以用鍵盤觸發', async () => {
    const onSortingChange = vi.fn();
    render(<Table data={data} columns={columns} onSortingChange={onSortingChange} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: '名稱' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onSortingChange).toHaveBeenCalledWith([{ sortBy: 'name', sortOrder: 'asc' }]);
  });

  it('enableSorting: false 的欄位不可排序', () => {
    render(
      <Table
        data={data}
        columns={[{ ...columns[0], id: 'name', enableSorting: false } as ColumnDef<Row, unknown>]}
        onSortingChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('columnheader', { name: '名稱' })).not.toHaveAttribute('data-sortable');
    expect(screen.queryByRole('button', { name: '名稱' })).not.toBeInTheDocument();
  });

  it('只有宣告 size 的欄位才設定寬度', () => {
    render(
      <Table
        data={data}
        columns={[
          { id: 'name', header: '名稱', size: 240, cell: ({ row }) => row.original.name },
          { id: 'id', header: 'ID', cell: ({ row }) => row.original.id },
        ]}
      />,
    );
    expect(screen.getByRole('columnheader', { name: '名稱' })).toHaveStyle({ width: '240px' });
    expect(screen.getByRole('columnheader', { name: 'ID' }).style.width).toBe('');
  });

  it('排序中的欄位標記 aria-sort', () => {
    render(
      <Table
        data={data}
        columns={columns}
        sorting={[{ sortBy: 'name', sortOrder: 'asc' }]}
        onSortingChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /名稱/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('選取中的列以 data-selected 標記、可排序的表頭以 data-sortable 標記', () => {
    render(
      <Table
        data={data}
        columns={columns}
        getRowId={(row) => row.id}
        rowSelection={{ '2': true }}
        onRowSelectionChange={vi.fn()}
        onSortingChange={vi.fn()}
      />,
    );
    const [first, second] = screen.getAllByTestId('table-row');
    expect(first).not.toHaveAttribute('data-selected');
    expect(second).toHaveAttribute('data-selected');
    expect(screen.getByRole('columnheader', { name: '名稱' })).toHaveAttribute('data-sortable');
  });

  it('點擊列內的按鈕只觸發按鈕，不切換選取也不開詳情', async () => {
    const onRowSelectionChange = vi.fn();
    const onRowDoubleClick = vi.fn();
    const onEdit = vi.fn();
    render(
      <Table
        data={data}
        columns={[
          ...columns,
          {
            id: 'actions',
            header: '操作',
            cell: () => (
              <button type="button" onClick={onEdit}>
                編輯
              </button>
            ),
          },
        ]}
        getRowId={(row) => row.id}
        rowSelection={{ '2': true }}
        onRowSelectionChange={onRowSelectionChange}
        onRowDoubleClick={onRowDoubleClick}
      />,
    );
    await userEvent.dblClick(screen.getAllByRole('button', { name: '編輯' })[0] as HTMLElement);
    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(onRowSelectionChange).not.toHaveBeenCalled();
    expect(onRowDoubleClick).not.toHaveBeenCalled();
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
