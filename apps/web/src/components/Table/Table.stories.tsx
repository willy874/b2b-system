import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { useState } from 'react';
import { fn } from 'storybook/test';

import type { TableSortOrder, TableSorting } from './sorting';
import { Table } from './Table';

interface Row {
  id: string;
  name: string;
  qty: number;
  price: number;
}

const data: Row[] = [
  { id: '1', name: '藍牙耳機', qty: 24, price: 1290 },
  { id: '2', name: '機械鍵盤', qty: 8, price: 2490 },
  { id: '3', name: '無線滑鼠', qty: 42, price: 690 },
  { id: '4', name: '行動電源', qty: 3, price: 890 },
];

const columns: Array<ColumnDef<Row, unknown>> = [
  { id: 'name', header: '商品', cell: ({ row }) => row.original.name },
  { id: 'qty', header: '數量', cell: ({ row }) => row.original.qty, size: 120 },
  { id: 'price', header: '價格', cell: ({ row }) => `NT$ ${row.original.price}`, size: 120 },
];

// 為了讓 Meta / Story 型別對到 `Table<Row>` 這個實例化後的函式（instantiation expression）
const TypedTable = Table<Row>;

const meta = {
  title: 'Components/Table',
  component: TypedTable,
  args: {
    data,
    columns,
    getRowId: (row: Row) => row.id,
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof TypedTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {};

export const Loading: Story = {
  args: { loading: true },
};

export const Empty: Story = {
  args: { data: [], emptyTitle: '沒有商品', emptyDescription: '目前還沒有任何商品資料。' },
};

/** 排序交給伺服器（`manualSorting`）：這裡用 `useState` 模擬「回報排序 → 重新取資料」的流程。 */
function SortableDemo() {
  const [sorting, setSorting] = useState<TableSorting>({ sortBy: 'qty', sortOrder: 'asc' });
  const sorted = data.toSorted((a, b) => {
    const order = sorting.sortOrder === 'asc' ? 1 : -1;
    if (sorting.sortBy === 'qty') return (a.qty - b.qty) * order;
    if (sorting.sortBy === 'price') return (a.price - b.price) * order;
    return a.name.localeCompare(b.name) * order;
  });
  const handleSortingChange = (sortBy: string, sortOrder: TableSortOrder) => {
    setSorting({ sortBy, sortOrder });
  };
  return (
    <Table
      data={sorted}
      columns={columns}
      getRowId={(row) => row.id}
      sorting={sorting}
      onSortingChange={handleSortingChange}
    />
  );
}

export const Sortable: Story = {
  render: () => <SortableDemo />,
};

/** 已進入選取模式（至少勾選一列）時，單擊列身即可切換選取。 */
function SelectableDemo() {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({ '2': true });
  return (
    <Table
      data={data}
      columns={columns}
      getRowId={(row) => row.id}
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      onRowDoubleClick={fn()}
    />
  );
}

export const Selectable: Story = {
  render: () => <SelectableDemo />,
};
