import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DataGrid, parseTsv } from './index';
import type { DataGridColumn, DataGridRow } from './index';

// jsdom 沒有 ResizeObserver；底層表格用它量測可視範圍
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const columns: DataGridColumn[] = [
  { key: 'email', name: 'Email', required: true, description: '必填' },
  { key: 'name', name: '名稱' },
];
const rows: DataGridRow[] = [
  {
    key: 1,
    header: '1',
    cells: { email: 'bad', name: 'A' },
    states: { email: { tone: 'error', message: 'Email 格式不正確' } },
    tone: 'error',
  },
  { key: 2, header: '2', cells: { email: 'b@example.com', name: 'B' } },
];

describe('DataGrid', () => {
  it('以 grid 角色呈現；必填欄有報讀器看得到的標記', () => {
    render(<DataGrid columns={columns} rows={rows} aria-label="預覽" data-testid="grid" />);
    const grid = screen.getByRole('grid', { name: '預覽' });
    expect(within(grid).getByRole('columnheader', { name: /Email/ })).toHaveTextContent('必填');
    expect(screen.getByTestId('grid')).toBeInTheDocument();
  });

  it('錯誤的儲存格標 aria-invalid，訊息放在 title', () => {
    render(<DataGrid columns={columns} rows={rows} aria-label="預覽" />);
    const value = screen.getByText('bad');
    expect(value).toHaveAttribute('aria-invalid', 'true');
    expect(value).toHaveAttribute('title', 'Email 格式不正確');
  });

  it('Delete 清空目前的儲存格，以 onCellsChange 回報', () => {
    const onCellsChange = vi.fn();
    render(
      <DataGrid columns={columns} rows={rows} onCellsChange={onCellsChange} aria-label="預覽" />,
    );
    // jsdom 沒有寬度：欄位虛擬捲動只渲染第一個資料欄
    const cell = screen.getByText('b@example.com').closest('[role="gridcell"]') as HTMLElement;
    fireEvent.mouseDown(cell);
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'Delete' });
    expect(onCellsChange).toHaveBeenCalledWith([{ rowIndex: 1, key: 'email', value: '' }]);
  });

  it('Ctrl＋Z 交給呼叫端的復原', () => {
    const onUndo = vi.fn();
    render(
      <DataGrid
        columns={columns}
        rows={rows}
        onCellsChange={vi.fn()}
        onUndo={onUndo}
        aria-label="預覽"
      />,
    );
    const cell = screen.getByText('bad').closest('[role="gridcell"]') as HTMLElement;
    fireEvent.mouseDown(cell);
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'z', ctrlKey: true });
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it('parseTsv：Excel 複製的範圍（Tab、換行、引號內的換行）', () => {
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseTsv('"x\ny"\tz')).toEqual([['x\ny', 'z']]);
    expect(parseTsv('single')).toEqual([['single']]);
  });
});
