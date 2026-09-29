import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ColumnDef } from '@tanstack/react-table';
import { fn } from 'storybook/test';

import { Button } from '../Button';
import { BatchActionBar } from './BatchActionBar';
import { createSelectColumn } from './columns';
import { Table } from './Table';
import { useTableSelection } from './useTableSelection';

const meta = {
  title: 'Components/Table/BatchActionBar',
  component: BatchActionBar,
  args: { count: 3, onClear: fn() },
} satisfies Meta<typeof BatchActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <BatchActionBar {...args}>
      <Button size="sm">啟用</Button>
      <Button size="sm" variant="danger">
        刪除
      </Button>
    </BatchActionBar>
  ),
};

interface Row {
  id: string;
  name: string;
}

const data: Row[] = [
  { id: '1', name: '藍牙耳機' },
  { id: '2', name: '機械鍵盤' },
  { id: '3', name: '無線滑鼠' },
];
const getRowId = (row: Row) => row.id;
const columns: Array<ColumnDef<Row, unknown>> = [
  createSelectColumn<Row>(),
  { id: 'name', header: '商品', cell: ({ row }) => row.original.name },
];

/** 搭配 `useTableSelection`：勾選後出現操作列，清除選取後消失。 */
function WithTableDemo() {
  const selection = useTableSelection(data, getRowId);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {selection.selectedIds.length > 0 && (
        <BatchActionBar count={selection.selectedIds.length} onClear={selection.clear}>
          <Button size="sm" variant="danger">
            刪除
          </Button>
        </BatchActionBar>
      )}
      <Table
        data={data}
        columns={columns}
        getRowId={getRowId}
        rowSelection={selection.rowSelection}
        onRowSelectionChange={selection.onRowSelectionChange}
      />
    </div>
  );
}

export const WithTable: Story = {
  render: () => <WithTableDemo />,
};
