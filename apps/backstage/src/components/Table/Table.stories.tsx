import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { IconButton } from '../Button';
import { Icon } from '../Icon';
import { JsonViewer } from '../JsonViewer';
import { createSelectColumn } from './columns';
import type { TableColumnDef } from './features';
import type { TableSorting } from './sorting';
import { Table } from './Table';
import { useTableSelection } from './useTableSelection';

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

const columns: Array<TableColumnDef<Row>> = [
  { id: 'name', header: '商品', cell: ({ row }) => row.original.name },
  { id: 'qty', header: '數量', cell: ({ row }) => row.original.qty, size: 120 },
  {
    id: 'price',
    header: '價格',
    cell: ({ row }) => `NT$ ${row.original.price}`,
    size: 120,
  },
];

const getRowId = (row: Row) => row.id;

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
  args: {
    data: [],
    emptyTitle: '沒有商品',
    emptyDescription: '目前還沒有任何商品資料。',
  },
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
 * `headerTrailing` 固定在最後一欄表頭的右側（與標題垂直置中）（列表頁用來放篩選、欄位設定按鈕）；
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

const selectableColumns = [createSelectColumn<Row>(), ...columns];

/**
 * 勾選欄（`createSelectColumn`）＋ `useTableSelection`：表頭全選本頁、跨頁保留選取與資料。
 * 已進入選取模式（至少勾選一列）時，單擊列身也能切換選取。
 */
function SelectableDemo() {
  const selection = useTableSelection(data, getRowId);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Table
        data={data}
        columns={selectableColumns}
        getRowId={getRowId}
        rowSelection={selection.rowSelection}
        onRowSelectionChange={selection.onRowSelectionChange}
        onRowDoubleClick={fn()}
      />
      <span>已選取：{selection.selectedRows.map((row) => row.name).join('、') || '無'}</span>
    </div>
  );
}

export const Selectable: Story = {
  render: () => <SelectableDemo />,
};

const wideColumns: Array<TableColumnDef<Row>> = [
  ...columns,
  ...['分類', '供應商', '倉庫', '建立時間', '更新時間'].map((header): TableColumnDef<Row> => ({
    id: header,
    header,
    cell: () => <span style={{ whiteSpace: 'nowrap' }}>一段比較長的欄位內容</span>,
  })),
  {
    id: 'actions',
    header: '操作',
    cell: () => (
      <IconButton size="sm" aria-label="刪除">
        <Icon name="trash" size={16} />
      </IconButton>
    ),
  },
];

/**
 * 展開列：點操作欄的箭頭，在該列正下方顯示橫跨所有欄位的內容。
 * 內容再寬也不影響欄寬（展開／收合時欄位不跳動），寬的部分在內容自己的框裡捲動。
 */
export const Expandable: Story = {
  render: () => <ExpandableDemo />,
};

function ExpandableDemo() {
  const [expanded, setExpanded] = useState<string>();
  const expandColumns: Array<TableColumnDef<Row>> = [
    ...columns,
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const isExpanded = expanded === row.original.id;
        return (
          <IconButton
            size="sm"
            aria-label={isExpanded ? '收合' : '展開'}
            aria-expanded={isExpanded}
            onClick={() => setExpanded(isExpanded ? undefined : row.original.id)}
          >
            <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={16} />
          </IconButton>
        );
      },
    },
  ];
  return (
    <Table
      data={data}
      columns={expandColumns}
      getRowId={(row) => row.id}
      expandedRowIds={expanded ? [expanded] : undefined}
      renderExpandedRow={(row) => (
        <JsonViewer
          aria-label={row.name}
          value={{
            ...row,
            description: `${row.name}的說明很長，展開後不會把欄位撐寬，而是在框內水平捲動。`.repeat(
              3,
            ),
            history: Array.from({ length: 30 }, (_, index) => ({ index, qty: row.qty - index })),
          }}
        />
      )}
    />
  );
}

/** 欄位多到要水平捲動時，`actions` 欄預設固定在右側。 */
export const PinnedActions: Story = {
  args: { columns: wideColumns },
};

const manyRows: Row[] = Array.from({ length: 30 }, (_, index) => ({
  id: String(index + 1),
  name: `商品 ${index + 1}`,
  qty: (index * 7) % 50,
  price: 100 + index * 10,
}));

/**
 * 固定表頭與釘選列：外框變成最高 `maxHeight` 的捲動框，表頭留在上方；
 * `rowPinning.top` 的列貼在頂端、`bottom` 的貼在底端；「商品」欄固定在左側、`actions` 固定在右側。
 */
export const StickyHeaderAndPinnedRows: Story = {
  args: {
    data: manyRows,
    columns: wideColumns,
    stickyHeader: true,
    maxHeight: 320,
    rowPinning: { top: ['12', '5'], bottom: ['20'] },
    columnPinning: { start: ['name'], end: ['actions'] },
  },
};
