import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createSelectColumn, SELECT_COLUMN_ID, UTILITY_COLUMN_SIZE } from './columns';
import type { TableColumnDef } from './features';
import { Table } from './index';
import { useTableSelection } from './useTableSelection';

interface Row {
  id: string;
  name: string;
}

const getRowId = (row: Row) => row.id;
const page1: Row[] = [
  { id: '1', name: 'A' },
  { id: '2', name: 'B' },
];
const page2: Row[] = [
  { id: '3', name: 'C' },
  { id: '4', name: 'D' },
];

function renderSelection(initial: readonly Row[]) {
  return renderHook(({ data }) => useTableSelection(data, getRowId), {
    initialProps: { data: initial },
  });
}

describe('useTableSelection（跨頁保留的選取）', () => {
  it('勾選後回傳 rowSelection、id 與整筆資料', () => {
    const { result } = renderSelection(page1);

    act(() => result.current.onRowSelectionChange({ '2': true }));

    expect(result.current.rowSelection).toEqual({ '2': true });
    expect(result.current.selectedIds).toEqual(['2']);
    expect(result.current.selectedRows).toEqual([{ id: '2', name: 'B' }]);
  });

  it('換頁後其他頁的勾選仍保留，資料是勾選當下的那一筆', () => {
    const { result, rerender } = renderSelection(page1);
    act(() => result.current.onRowSelectionChange({ '1': true }));

    rerender({ data: page2 });
    act(() => result.current.onRowSelectionChange({ ...result.current.rowSelection, '4': true }));

    expect(result.current.selectedIds).toEqual(['1', '4']);
    expect(result.current.selectedRows).toEqual([
      { id: '1', name: 'A' },
      { id: '4', name: 'D' },
    ]);
  });

  it('列還在目前的資料裡時換成最新的那一筆', () => {
    const { result, rerender } = renderSelection(page1);
    act(() => result.current.onRowSelectionChange({ '1': true }));

    rerender({ data: [{ id: '1', name: 'A（已改名）' }, page1[1]!] });

    expect(result.current.selectedRows).toEqual([{ id: '1', name: 'A（已改名）' }]);
  });

  it('依勾選順序排列，不依 id 的數字大小', () => {
    const { result } = renderSelection([...page1, ...page2]);

    act(() => result.current.onRowSelectionChange({ '3': true }));
    act(() => result.current.onRowSelectionChange({ ...result.current.rowSelection, '1': true }));

    expect(result.current.selectedIds).toEqual(['3', '1']);
  });

  it('不在新的選取裡的列移除（取消勾選）', () => {
    const { result } = renderSelection(page1);
    act(() => result.current.onRowSelectionChange({ '1': true, '2': true }));

    act(() => result.current.onRowSelectionChange({ '2': true }));

    expect(result.current.selectedIds).toEqual(['2']);
  });

  it('不在資料裡、也沒有快照的 id 略過', () => {
    const { result } = renderSelection(page1);

    act(() => result.current.onRowSelectionChange({ '1': true, ghost: true }));

    expect(result.current.selectedIds).toEqual(['1']);
  });

  it('clear 清空選取', () => {
    const { result } = renderSelection(page1);
    act(() => result.current.onRowSelectionChange({ '1': true }));

    act(() => result.current.clear());

    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.rowSelection).toEqual({});
  });
});

const nameColumn: TableColumnDef<Row> = {
  id: 'name',
  header: '名稱',
  cell: ({ row }) => row.original.name,
};

function SelectableTable({ data }: { data: Row[] }) {
  const selection = useTableSelection(data, getRowId);
  return (
    <>
      <Table
        data={data}
        columns={[createSelectColumn<Row>(), nameColumn]}
        getRowId={getRowId}
        rowSelection={selection.rowSelection}
        onRowSelectionChange={selection.onRowSelectionChange}
      />
      <output data-testid="selected">{selection.selectedIds.join(',')}</output>
    </>
  );
}

describe('createSelectColumn（勾選欄）', () => {
  it('欄位定義：固定的 id、工具欄寬度、不可排序、欄位設定的名稱', () => {
    const column = createSelectColumn<Row>({
      column: 'Select',
      selectAll: 'Select page',
      selectRow: 'Select row',
    });
    expect(column).toMatchObject({
      id: SELECT_COLUMN_ID,
      size: UTILITY_COLUMN_SIZE,
      enableSorting: false,
      meta: { settingsLabel: 'Select' },
    });
  });

  it('勾選一列：表頭顯示半選', async () => {
    render(<SelectableTable data={page1} />);

    await userEvent.click(screen.getAllByRole('checkbox', { name: '選取這一列' })[0]!);

    expect(screen.getByTestId('selected')).toHaveTextContent('1');
    expect(screen.getByRole('checkbox', { name: '全選本頁' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
  });

  it('表頭全選本頁、再按一次取消', async () => {
    render(<SelectableTable data={page1} />);
    const selectAll = () => screen.getByRole('checkbox', { name: '全選本頁' });

    await userEvent.click(selectAll());
    expect(screen.getByTestId('selected')).toHaveTextContent('1,2');
    expect(selectAll()).toBeChecked();

    await userEvent.click(selectAll());
    expect(screen.getByTestId('selected')).toBeEmptyDOMElement();
  });
});
