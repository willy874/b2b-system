import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { DataGrid } from './DataGrid';
import type { DataGridCellChange, DataGridColumn, DataGridRow } from './DataGrid';

const columns: DataGridColumn[] = [
  { key: 'email', name: 'Email', required: true, description: '必填，不可重複' },
  { key: 'name', name: '名稱', width: 140 },
  {
    key: 'status',
    name: '狀態',
    options: [
      { value: 'active', label: '啟用' },
      { value: 'inactive', label: '停用' },
    ],
  },
  {
    key: 'tags',
    name: '標籤',
    description: '多個以 ; 分隔',
    loadSuggestions: async (keyword) =>
      ['紅', '橙', '黃', '綠'].filter((item) => item.includes(keyword)),
  },
];

function initialRows(count: number): DataGridRow[] {
  return Array.from({ length: count }, (_, index) => ({
    key: index + 1,
    header: String(index + 1),
    cells: {
      email: index === 2 ? 'not-an-email' : `user${index + 1}@example.com`,
      name: `使用者 ${index + 1}`,
      status: '啟用',
      tags: '',
    },
    states: index === 2 ? { email: { tone: 'error', message: 'Email 格式不正確' } } : undefined,
    tone: index === 2 ? 'error' : undefined,
  }));
}

function Editable({ count }: { count: number }) {
  const [rows, setRows] = useState(() => initialRows(count));
  const apply = (changes: DataGridCellChange[]) =>
    setRows((current) =>
      current.map((row, index) => {
        const mine = changes.filter((change) => change.rowIndex === index);
        if (!mine.length) return row;
        const cells = { ...row.cells };
        for (const change of mine) cells[change.key] = change.value;
        return { ...row, cells, states: undefined, tone: undefined };
      }),
    );
  return (
    <div style={{ height: 420 }}>
      <DataGrid columns={columns} rows={rows} onCellsChange={apply} aria-label="預覽" />
    </div>
  );
}

const meta = {
  title: 'Components/DataGrid',
  component: DataGrid,
  args: { columns, rows: initialRows(20), 'aria-label': '預覽' },
  decorators: [
    (Story) => (
      <div style={{ height: 420, width: 760 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DataGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 唯讀：錯誤儲存格的紅框與三角。 */
export const Playground: Story = {};

/** 可編輯：Enter 編輯、Delete 清空、Ctrl＋V 貼上 TSV、F8 跳到下一個錯誤。 */
export const Editable5000Rows: Story = {
  render: () => <Editable count={5000} />,
};
