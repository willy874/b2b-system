import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DataGrid, parseTsv } from './index';
import type { DataGridColumn, DataGridRow } from './index';

// jsdom 沒有 ResizeObserver（底層表格用它量測可視範圍）與 scrollIntoView（結束編輯時捲到儲存格）
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
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

  /** 選取一格並進入編輯（jsdom 沒有寬度：只渲染第一個資料欄，要測的欄位放第一個）。 */
  function editCell(text: string) {
    const cell = screen.getByText(text).closest('[role="gridcell"]') as HTMLElement;
    fireEvent.mouseDown(cell);
    fireEvent.click(cell);
    fireEvent.doubleClick(cell);
    return cell;
  }

  function paste(target: Element, text: string) {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData: () => string; setData: () => void };
    };
    event.clipboardData = { getData: () => text, setData: () => {} };
    fireEvent(target, event);
    return event;
  }

  it('Ctrl＋V：選取儲存格時貼上 TSV 範圍；編輯中只貼到輸入框（瀏覽器的預設）', () => {
    const onCellsChange = vi.fn();
    render(
      <DataGrid columns={columns} rows={rows} onCellsChange={onCellsChange} aria-label="預覽" />,
    );
    const cell = screen.getByText('bad').closest('[role="gridcell"]') as HTMLElement;
    fireEvent.mouseDown(cell);
    fireEvent.click(cell);
    expect(paste(cell, 'x@example.com\ny@example.com').defaultPrevented).toBe(true);
    expect(onCellsChange).toHaveBeenCalledWith([
      { rowIndex: 0, key: 'email', value: 'x@example.com' },
      { rowIndex: 1, key: 'email', value: 'y@example.com' },
    ]);

    onCellsChange.mockClear();
    fireEvent.doubleClick(cell);
    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(paste(input, 'x\ty').defaultPrevented).toBe(false);
    expect(onCellsChange).not.toHaveBeenCalled();
  });

  it('下拉選單的欄位：編輯器是 Select（直接展開），選了就寫回', async () => {
    const onCellsChange = vi.fn();
    render(
      <DataGrid
        columns={[
          {
            key: 'status',
            name: '狀態',
            options: [
              { value: '啟用', label: '啟用' },
              { value: '停用', label: '停用' },
            ],
          },
        ]}
        rows={[{ key: 1, cells: { status: '啟用' } }]}
        onCellsChange={onCellsChange}
        aria-label="預覽"
      />,
    );
    editCell('啟用');
    expect(screen.getByRole('combobox', { name: '狀態' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(await screen.findByRole('option', { name: '停用' }));
    expect(onCellsChange).toHaveBeenCalledWith([{ rowIndex: 0, key: 'status', value: '停用' }]);
  });

  it('多選：遠端查詢選項，勾選後以 ; 串接，收合時寫回', async () => {
    const onCellsChange = vi.fn();
    const loadOptions = vi.fn(async (keyword: string) =>
      ['稽核人員', '一般成員']
        .filter((name) => name.includes(keyword))
        .map((name) => ({ value: name, label: name })),
    );
    render(
      <DataGrid
        columns={[
          { key: 'roles', name: '角色', multiple: true, loadOptions },
          { key: 'name', name: '名稱' },
        ]}
        rows={[{ key: 1, cells: { roles: '稽核人員', name: 'A' } }]}
        onCellsChange={onCellsChange}
        aria-label="預覽"
      />,
    );
    editCell('稽核人員');
    expect(loadOptions).toHaveBeenCalledWith('');
    fireEvent.click(await screen.findByRole('option', { name: '一般成員' }));
    // 還沒收合：只改編輯中的值
    expect(onCellsChange).not.toHaveBeenCalled();
    // 鍵盤：在搜尋框按 Tab 寫回並結束編輯
    act(() => {
      fireEvent.keyDown(screen.getByTestId('select-search'), { key: 'Tab' });
    });
    expect(onCellsChange).toHaveBeenCalledWith([
      { rowIndex: 0, key: 'roles', value: '稽核人員;一般成員' },
    ]);
  });

  it('自動完成：輸入時列出建議，↓ 選擇、Enter 採用', async () => {
    const onCellsChange = vi.fn();
    const loadSuggestions = vi.fn(async (keyword: string) =>
      keyword.endsWith('@') ? [`${keyword}example.com`] : [],
    );
    render(
      <DataGrid
        columns={[{ key: 'email', name: 'Email', loadSuggestions }]}
        rows={[{ key: 1, cells: { email: 'old' } }]}
        onCellsChange={onCellsChange}
        aria-label="預覽"
      />,
    );
    editCell('old');
    const input = screen.getByRole('combobox', { name: 'Email' });
    fireEvent.change(input, { target: { value: 'carol@' } });
    const option = await screen.findByRole('option', { name: 'carol@example.com' });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', option.id);
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onCellsChange).toHaveBeenCalledWith([
      { rowIndex: 0, key: 'email', value: 'carol@example.com' },
    ]);
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
