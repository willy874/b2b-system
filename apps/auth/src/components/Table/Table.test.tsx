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
          {
            id: 'name',
            header: '名稱',
            size: 240,
            cell: ({ row }) => row.original.name,
          },
          { id: 'id', header: 'ID', cell: ({ row }) => row.original.id },
        ]}
      />,
    );
    expect(screen.getByRole('columnheader', { name: '名稱' })).toHaveStyle({
      width: '240px',
    });
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

  describe('展開列', () => {
    it('展開的列正下方插入一列，橫跨所有欄位', () => {
      render(
        <Table
          data={data}
          columns={[...columns, { id: 'extra', header: '備註', cell: () => '-' }]}
          getRowId={(row) => row.id}
          expandedRowIds={['1']}
          renderExpandedRow={(row) => `明細：${row.name}`}
        />,
      );
      const rows = screen.getAllByRole('row');
      // 表頭、第一列、第一列的展開、第二列
      expect(rows).toHaveLength(4);
      expect(rows[2]).toHaveAttribute('data-testid', 'table-expanded-row');
      expect(rows[2]).toHaveTextContent('明細：系統管理員');
      expect(rows[2]?.querySelector('td')).toHaveAttribute('colspan', '2');
      expect(rows[1]).toHaveAttribute('data-expanded');
    });

    it('沒有 renderExpandedRow 或沒展開時不插入', () => {
      render(
        <Table data={data} columns={columns} getRowId={(row) => row.id} expandedRowIds={['1']} />,
      );
      expect(screen.queryByTestId('table-expanded-row')).not.toBeInTheDocument();
    });
  });

  describe('換行', () => {
    it('儲存格預設不換行；meta.wrap 的欄位才標上 data-wrap', () => {
      render(
        <Table
          data={data}
          columns={[
            { id: 'name', header: '名稱', cell: ({ row }) => row.original.name },
            {
              id: 'note',
              header: '備註',
              cell: ({ row }) => row.original.name,
              meta: { wrap: true },
            },
          ]}
        />,
      );
      const [name, note] = screen.getAllByRole('cell');
      expect(name).not.toHaveAttribute('data-wrap');
      expect(note).toHaveAttribute('data-wrap');
    });
  });

  describe('欄位固定', () => {
    const withActions: Array<ColumnDef<Row, unknown>> = [
      { id: 'actions', header: '操作', cell: () => '…' },
      ...columns,
    ];

    it('預設把 actions 欄固定在最右側', () => {
      render(<Table data={data} columns={withActions} getRowId={(row) => row.id} />);
      const headers = screen.getAllByRole('columnheader');
      expect(headers.map((header) => header.textContent)).toEqual(['名稱', '操作']);
      expect(headers[1]).toHaveAttribute('data-pinned', 'right');
      expect(headers[1]).toHaveStyle({ right: '0px' });
      const cells = screen.getAllByRole('cell');
      expect(cells[1]).toHaveAttribute('data-pinned', 'right');
      expect(cells[1]).toHaveAttribute('data-pinned-edge', 'true');
    });

    it('columnPinning 傳 {} 時不固定任何欄位', () => {
      render(<Table data={data} columns={withActions} columnPinning={{}} />);
      const headers = screen.getAllByRole('columnheader');
      expect(headers.map((header) => header.textContent)).toEqual(['操作', '名稱']);
      expect(headers[0]).not.toHaveAttribute('data-pinned');
    });
  });

  describe('資料列釘選', () => {
    const many: Row[] = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
      { id: '3', name: 'C' },
      { id: '4', name: 'D' },
    ];

    it('top 依序排在最前、bottom 依序排在最後，並把外框變成捲動框', () => {
      render(
        <Table
          data={many}
          columns={columns}
          getRowId={(row) => row.id}
          rowPinning={{ top: ['3'], bottom: ['1', '2'] }}
        />,
      );
      const rows = screen.getAllByTestId('table-row');
      expect(rows.map((row) => row.textContent)).toEqual(['C', 'D', 'A', 'B']);
      expect(rows[0]).toHaveAttribute('data-pinned-row', 'top');
      expect(rows[0]).toHaveAttribute('data-pinned-row-edge');
      expect(rows[2]).toHaveAttribute('data-pinned-row', 'bottom');
      expect(rows[2]).toHaveAttribute('data-pinned-row-edge');
      expect(rows[3]).not.toHaveAttribute('data-pinned-row-edge');
      expect(screen.getByRole('table').parentElement).toHaveAttribute('data-scrollable');
    });
  });
});
