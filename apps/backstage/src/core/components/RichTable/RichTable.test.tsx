import type { ColumnDef } from '@tanstack/react-table';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTableSelection } from '@/components/Table';
import { useTableColumnSettingsStore } from '@/core/store';

import type { FilterBarProps } from './FilterBar';
import { RichTable } from './RichTable';

const getId = (row: { id: string }) => row.id;

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
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
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

/** 一般欄位的表頭文字（略過勾選欄、釘選欄這些工具欄）。 */
function headers(): string[] {
  return screen
    .getAllByRole('columnheader')
    .filter((header) => !header.dataset.columnId?.startsWith('__'))
    .map((header) => header.textContent?.trim() ?? '');
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
    useTableColumnSettingsStore.setState({ settings: {}, pinnedRows: {} });
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
      'b2b-system:table-column-settings:tables',
      JSON.stringify({
        sample: { order: ['note', 'name', 'code'], hidden: ['code'] },
      }),
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

function storeSampleSettings(settings: Record<string, unknown>) {
  localStorage.setItem(
    'b2b-system:table-column-settings:tables',
    JSON.stringify({ sample: { order: ['name'], hidden: [], ...settings } }),
  );
}

/** 各列的名稱：用 Name 欄（`data-column-id` 對到的那一格），不受工具欄在前面影響。 */
function rowNames() {
  const nameIndex = screen
    .getAllByRole('columnheader')
    .findIndex((header) => header.dataset.columnId === 'name');
  return screen
    .getAllByTestId('table-row')
    .map((row) => (row as HTMLTableRowElement).cells[nameIndex]?.textContent);
}

describe('RichTable 的欄位固定與固定表頭（依每張表的欄位設定）', () => {
  const pinColumns: Array<ColumnDef<Row, unknown>> = [
    ...columns,
    { id: 'code', header: 'Code', cell: ({ row }) => row.original.id },
    { id: 'actions', header: '操作', cell: () => null },
  ];

  beforeEach(() => {
    localStorage.clear();
    useTableColumnSettingsStore.setState({ settings: {}, pinnedRows: {} });
  });

  it('預設操作欄固定在右側、表頭不固定', () => {
    render(<RichTable data={rows} columns={pinColumns} settings={{ tableId: 'sample' }} />);
    expect(screen.getByRole('columnheader', { name: /操作/ })).toHaveAttribute(
      'data-pinned',
      'right',
    );
    expect(screen.getByRole('table').parentElement).not.toHaveAttribute('data-sticky-header');
  });

  it('套用存下來的欄位固定：Code 固定在左側（排到最前面）、操作欄改到左側、表頭固定', () => {
    storeSampleSettings({
      order: ['name', 'code'],
      pinnedColumns: { code: 'start', actions: 'start' },
      stickyHeader: true,
    });
    render(<RichTable data={rows} columns={pinColumns} settings={{ tableId: 'sample' }} />);
    expect(headers()).toEqual(['Code', '操作', 'Name']);
    expect(screen.getByRole('columnheader', { name: 'Code' })).toHaveAttribute(
      'data-pinned',
      'left',
    );
    expect(screen.getByRole('columnheader', { name: /操作/ })).toHaveAttribute('data-pinned-edge');
    expect(screen.getByRole('table').parentElement).toHaveAttribute('data-sticky-header');
  });

  it('齒輪面板取消固定操作欄後寫入該表的設定', async () => {
    render(<RichTable data={rows} columns={pinColumns} settings={{ tableId: 'sample' }} />);
    await userEvent.click(screen.getByTestId('table-settings-trigger'));
    const popup = await screen.findByTestId('table-settings-popup');
    const actions = within(popup).getByTestId('table-settings-fixed-item');
    await userEvent.click(within(actions).getByTestId('table-settings-pin-end'));
    await userEvent.click(screen.getByTestId('table-settings-submit'));
    expect(useTableColumnSettingsStore.getState().settings.sample).toMatchObject({
      pinnedColumns: {},
    });
    expect(screen.getByRole('columnheader', { name: /操作/ })).not.toHaveAttribute('data-pinned');
  });
});

async function pinRowAt(rowIndex: number, option: 'top' | 'bottom' | 'unpin') {
  await userEvent.click(screen.getAllByTestId('table-row-pin')[rowIndex] as HTMLElement);
  const options = await screen.findAllByTestId('table-row-pin-option');
  const target = options.find((element) => element.dataset.value === option);
  if (!target) throw new Error(`找不到選項 ${option}`);
  await userEvent.click(target);
}

describe('RichTable 的釘選欄（PinColumn）', () => {
  const withActionsColumn: Array<ColumnDef<Row, unknown>> = [
    ...columns,
    { id: 'actions', header: '操作', cell: () => <button type="button">編輯</button> },
  ];
  const settings = { tableId: 'sample' };
  const threeRows: Row[] = [...rows, { id: '3', name: 'Carol' }];

  function showPinColumn() {
    storeSampleSettings({ order: ['__pin', 'name'], hidden: [] });
  }

  function renderTable(data: Row[] = threeRows) {
    return render(
      <RichTable
        data={data}
        columns={withActionsColumn}
        getRowId={(row) => row.id}
        settings={settings}
      />,
    );
  }

  beforeEach(() => {
    localStorage.clear();
    useTableColumnSettingsStore.setState({ settings: {}, pinnedRows: {} });
  });

  it('預設隱藏；在欄位設定裡列為可設定的欄位', async () => {
    renderTable();
    expect(screen.queryByTestId('table-row-pin')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('table-settings-trigger'));
    const popup = await screen.findByTestId('table-settings-popup');
    const pinItem = within(popup)
      .getAllByTestId('table-settings-item')
      .find((item) => item.dataset.value === '__pin');
    expect(pinItem).toBeDefined();
  });

  it('打開後是獨立的一欄，操作欄的內容不受影響', () => {
    showPinColumn();
    renderTable(rows);
    // 工具欄排在最前面：勾選欄、釘選欄
    expect(screen.getAllByRole('columnheader').map((header) => header.dataset.columnId)).toEqual([
      '__select',
      '__pin',
      'name',
      'actions',
    ]);
    expect(screen.getAllByTestId('table-row-pin')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '編輯' })).toHaveLength(2);
  });

  it('可以釘選到頂端或底端，並記進偏好；取消後回到原位', async () => {
    showPinColumn();
    renderTable();
    await pinRowAt(2, 'top');
    expect(rowNames()).toEqual(['Carol', 'Alice', 'Bob']);
    expect(screen.getAllByTestId('table-row')[0]).toHaveAttribute('data-pinned-row', 'top');

    // Alice 現在在第 2 列
    await pinRowAt(1, 'bottom');
    expect(rowNames()).toEqual(['Carol', 'Bob', 'Alice']);
    expect(screen.getAllByTestId('table-row')[2]).toHaveAttribute('data-pinned-row', 'bottom');
    expect(
      JSON.parse(localStorage.getItem('b2b-system:table-column-settings:pinnedRows') ?? '{}'),
    ).toEqual({
      sample: [
        { id: '3', side: 'top', row: { id: '3', name: 'Carol' } },
        { id: '1', side: 'bottom', row: { id: '1', name: 'Alice' } },
      ],
    });

    await pinRowAt(0, 'unpin');
    expect(rowNames()).toEqual(['Bob', 'Carol', 'Alice']);
  });

  it('換頁後釘選的列仍留在原位', async () => {
    showPinColumn();
    const { rerender } = renderTable(rows);
    await pinRowAt(0, 'top');
    rerender(
      <RichTable
        data={[{ id: '3', name: 'Carol' }]}
        columns={withActionsColumn}
        getRowId={(row) => row.id}
        settings={settings}
      />,
    );
    expect(rowNames()).toEqual(['Alice', 'Carol']);
  });

  it('enableRowPinning={false}、沒有 getRowId 或沒有 tableId 時不提供釘選欄', () => {
    showPinColumn();
    const { rerender } = render(
      <RichTable
        data={rows}
        columns={withActionsColumn}
        getRowId={(row) => row.id}
        settings={settings}
        enableRowPinning={false}
      />,
    );
    expect(screen.queryByTestId('table-row-pin')).not.toBeInTheDocument();
    rerender(<RichTable data={rows} columns={withActionsColumn} settings={settings} />);
    expect(screen.queryByTestId('table-row-pin')).not.toBeInTheDocument();
    rerender(<RichTable data={rows} columns={withActionsColumn} getRowId={(row) => row.id} />);
    expect(screen.queryByTestId('table-row-pin')).not.toBeInTheDocument();
  });
});

describe('RichTable 的勾選欄（CheckboxColumn）', () => {
  const pageOne: Row[] = rows;
  const pageTwo: Row[] = [{ id: '3', name: 'Carol' }];

  function SelectionDemo({ data }: { data: Row[] }) {
    const selection = useTableSelection(data, getId);
    return (
      <>
        <RichTable
          data={data}
          columns={columns}
          getRowId={getId}
          settings={{ tableId: 'sample' }}
          rowSelection={selection.rowSelection}
          onRowSelectionChange={selection.onRowSelectionChange}
        />
        <output data-testid="selected">
          {selection.selectedRows.map((row) => row.name).join(',')}
        </output>
      </>
    );
  }

  beforeEach(() => {
    localStorage.clear();
    useTableColumnSettingsStore.setState({ settings: {}, pinnedRows: {} });
  });

  it('預設就有勾選欄：呼叫端沒接手時由 RichTable 自己管理選取；enableRowSelection={false} 時沒有', async () => {
    const { rerender } = render(
      <RichTable data={rows} columns={columns} settings={{ tableId: 'sample' }} />,
    );
    await userEvent.click(screen.getAllByTestId('table-select-row')[0] as HTMLElement);
    expect(screen.getAllByTestId('table-row')[0]).toHaveAttribute('data-selected');

    rerender(
      <RichTable
        data={rows}
        columns={columns}
        settings={{ tableId: 'sample' }}
        enableRowSelection={false}
      />,
    );
    expect(screen.queryByTestId('table-select-all')).not.toBeInTheDocument();
  });

  it('預設排在最前面並固定在 start', () => {
    render(<SelectionDemo data={pageOne} />);
    const first = screen.getAllByRole('columnheader')[0];
    expect(first).toHaveAttribute('data-column-id', '__select');
    expect(first).toHaveAttribute('data-pinned', 'left');
  });

  it('勾選列、全選本頁；換頁後其他頁的勾選與資料都保留', async () => {
    const { rerender } = render(<SelectionDemo data={pageOne} />);
    await userEvent.click(screen.getAllByTestId('table-select-row')[1] as HTMLElement);
    expect(screen.getByTestId('selected')).toHaveTextContent('Bob');
    expect(screen.getByTestId('table-select-all')).toHaveAttribute('aria-checked', 'mixed');

    await userEvent.click(screen.getByTestId('table-select-all'));
    expect(screen.getByTestId('selected')).toHaveTextContent('Bob,Alice');

    rerender(<SelectionDemo data={pageTwo} />);
    await userEvent.click(screen.getAllByTestId('table-select-row')[0] as HTMLElement);
    expect(screen.getByTestId('selected')).toHaveTextContent('Bob,Alice,Carol');
  });
});
