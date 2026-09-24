import type { ColumnDef } from '@tanstack/react-table';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTableColumnSettingsStore } from '@/core/store';

import type { FilterBarProps } from './FilterBar';
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

const withActions: Array<ColumnDef<Row, unknown>> = [
  ...columns,
  { id: 'actions', header: '操作', cell: () => null },
];
function filters(keyword?: string): FilterBarProps<{ keyword?: string }> {
  return {
    value: { keyword },
    onSubmit: vi.fn(),
    fields: [{ type: 'text', key: 'keyword', label: '關鍵字' }],
  };
}

describe('RichTable 的篩選按鈕', () => {
  it('固定在最後一欄的表頭，保留原本的標題', () => {
    render(<RichTable data={rows} columns={withActions} filters={filters()} />);
    const header = screen.getByRole('columnheader', { name: /操作/ });
    expect(header).toHaveTextContent('操作');
    expect(within(header).getByTestId('filter-bar-trigger')).toBeInTheDocument();
  });

  it('沒有操作欄時放在最後一欄（不論欄位 id）', () => {
    render(<RichTable data={rows} columns={columns} filters={filters()} />);
    const header = screen.getByRole('columnheader', { name: /Name/ });
    expect(within(header).getByTestId('filter-bar-trigger')).toBeInTheDocument();
  });

  it('可排序的最後一欄：按鈕不會被包進排序按鈕裡', () => {
    render(
      <RichTable data={rows} columns={columns} filters={filters()} onSortingChange={vi.fn()} />,
    );
    const trigger = screen.getByTestId('filter-bar-trigger');
    expect(screen.getByRole('button', { name: 'Name' })).not.toContainElement(trigger);
  });

  it('重新渲染（例如網址更新、欄位設定寫入）時面板不會被關掉', async () => {
    const { rerender } = render(
      <RichTable data={rows} columns={withActions} filters={filters()} />,
    );
    await userEvent.click(screen.getByTestId('filter-bar-trigger'));
    await screen.findByTestId('filter-bar-popup');

    await userEvent.type(screen.getByRole('textbox', { name: '關鍵字' }), 'draft');

    rerender(<RichTable data={rows} columns={withActions} filters={filters('alice')} />);
    expect(screen.getByTestId('filter-bar-popup')).toBeInTheDocument();
    // 草稿不會被外部的新值蓋掉
    expect(screen.getByRole('textbox', { name: '關鍵字' })).toHaveValue('draft');
  });
});

function headers(): string[] {
  return screen.getAllByRole('columnheader').map((header) => header.textContent?.trim() ?? '');
}

describe('RichTable 的欄位設定', () => {
  const settingsColumns: Array<ColumnDef<Row, unknown>> = [
    { id: 'name', header: 'Name', cell: ({ row }) => row.original.name },
    { id: 'code', header: 'Code', cell: ({ row }) => row.original.id },
    { id: 'note', header: 'Note', cell: () => '-' },
    { id: 'actions', header: '操作', cell: () => null },
  ];
  beforeEach(() => {
    localStorage.clear();
    useTableColumnSettingsStore.setState({ settings: {} });
  });

  it('沒有存過設定時照原本順序，套用 defaultHidden', () => {
    render(
      <RichTable
        data={rows}
        columns={settingsColumns}
        settings={{ tableId: 'sample', defaultHidden: ['note'] }}
      />,
    );
    expect(headers()).toEqual(['Name', 'Code', '操作']);
  });

  it('依存下來的設定重排與隱藏，操作欄固定在原位並帶著齒輪按鈕', () => {
    localStorage.setItem(
      'game-editor:table-column-settings:tables',
      JSON.stringify({ sample: { order: ['note', 'name', 'code'], hidden: ['code'] } }),
    );
    render(<RichTable data={rows} columns={settingsColumns} settings={{ tableId: 'sample' }} />);
    expect(headers()).toEqual(['Note', 'Name', '操作']);
    const actions = screen.getByRole('columnheader', { name: /操作/ });
    expect(within(actions).getByTestId('table-settings-trigger')).toBeInTheDocument();
  });

  it('沒有 settings 時不顯示齒輪按鈕', () => {
    render(<RichTable data={rows} columns={settingsColumns} />);
    expect(screen.queryByTestId('table-settings-trigger')).not.toBeInTheDocument();
  });
});
