import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { IconButton } from '../Button';
import { Icon } from '../Icon';
import type { TableSorting } from './sorting';
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

function compareBy(sortBy: string, a: (typeof data)[number], b: (typeof data)[number]): number {
  if (sortBy === 'qty') return a.qty - b.qty;
  if (sortBy === 'price') return a.price - b.price;
  return a.name.localeCompare(b.name);
}

/**
 * 排序交給伺服器（`manualSorting`）：這裡用 `useState` 模擬「回報排序 → 重新取資料」的流程。
 * 每一欄循環「不排 → 升冪 → 降冪 → 不排」，數字是優先順序。
 */
function SortableDemo() {
  const [sorting, setSorting] = useState<TableSorting[]>([{ sortBy: 'qty', sortOrder: 'asc' }]);
  const sorted = data.toSorted((a, b) => {
    for (const { sortBy, sortOrder } of sorting) {
      const result = compareBy(sortBy, a, b) * (sortOrder === 'asc' ? 1 : -1);
      if (result !== 0) return result;
    }
    return 0;
  });
  return (
    <Table
      data={sorted}
      columns={columns}
      getRowId={(row) => row.id}
      sorting={sorting}
      onSortingChange={setSorting}
    />
  );
}

export const Sortable: Story = {
  render: () => <SortableDemo />,
};

/**
 * `headerTrailing` 固定在最後一欄表頭的右下角（列表頁用來放篩選、欄位設定按鈕）；
 * 最後一欄的欄寬不夠時（把視窗縮窄看看），標題被裁掉，按鈕不縮。
 */
export const HeaderTrailing: Story = {
  args: {
    columns: [...columns, { id: 'note', header: '備註說明很長的欄位標題', cell: () => '-' }],
    headerTrailing: (
      <>
        <IconButton size="sm" aria-label="篩選">
          <Icon name="filter" size={16} />
        </IconButton>
        <IconButton size="sm" aria-label="欄位設定">
          <Icon name="settings" size={16} />
        </IconButton>
      </>
    ),
  },
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
