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

  /** 選取一格（不進入編輯）。 */
  function selectCell(text: string) {
    const cell = screen.getByText(text).closest('[role="gridcell"]') as HTMLElement;
    fireEvent.mouseDown(cell);
    fireEvent.click(cell);
    return cell;
  }

  const activeCellText = () =>
    screen.getAllByRole('gridcell').find((cell) => cell.getAttribute('aria-selected') === 'true')
      ?.textContent;

  it('F8 跳到下一個錯誤的儲存格，到底再從頭找', () => {
    const errorRows: DataGridRow[] = [
      { key: 1, cells: { email: 'ok-1' } },
      { key: 2, cells: { email: 'bad-2' }, states: { email: { tone: 'error' } } },
      { key: 3, cells: { email: 'ok-3' } },
    ];
    render(
      <DataGrid
        columns={[{ key: 'email', name: 'Email' }]}
        rows={errorRows}
        onCellsChange={vi.fn()}
        aria-label="預覽"
      />,
    );
    const start = selectCell('ok-3');

    fireEvent.keyDown(start, { key: 'F8' });

    expect(activeCellText()).toBe('bad-2');
  });

  it('Ctrl＋Shift＋Z 與 Ctrl＋Y 交給呼叫端的重做', () => {
    const onRedo = vi.fn();
    const onUndo = vi.fn();
    render(
      <DataGrid
        columns={columns}
        rows={rows}
        onCellsChange={vi.fn()}
        onUndo={onUndo}
        onRedo={onRedo}
        aria-label="預覽"
      />,
    );
    const cell = selectCell('bad');

    fireEvent.keyDown(cell, { key: 'Z', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(cell, { key: 'y', metaKey: true });

    expect(onRedo).toHaveBeenCalledTimes(2);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('Delete：空白的儲存格、不可編輯的欄位都不回報變更', () => {
    const onCellsChange = vi.fn();
    render(
      <DataGrid
        columns={[{ key: 'code', name: '代碼', editable: false }]}
        rows={[
          { key: 1, cells: { code: 'locked' } },
          { key: 2, cells: { code: '' } },
        ]}
        onCellsChange={onCellsChange}
        aria-label="預覽"
      />,
    );

    fireEvent.keyDown(selectCell('locked'), { key: 'Backspace' });

    expect(onCellsChange).not.toHaveBeenCalled();
  });

  it('沒有 onCellsChange 時是唯讀的：雙擊不進入編輯', () => {
    render(<DataGrid columns={columns} rows={rows} aria-label="預覽" />);
    const cell = selectCell('bad');

    fireEvent.keyDown(cell, { key: 'Delete' });
    fireEvent.doubleClick(cell);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('bad')).toBeInTheDocument();
  });

  it('Ctrl＋C 複製目前儲存格的原始字串', () => {
    render(<DataGrid columns={columns} rows={rows} aria-label="預覽" />);
    const cell = selectCell('b@example.com');
    const setData = vi.fn();
    const event = new Event('copy', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData: () => string; setData: typeof setData };
    };
    event.clipboardData = { getData: () => '', setData };

    fireEvent(cell, event);

    expect(setData).toHaveBeenCalledWith('text/plain', 'b@example.com');
    expect(event.defaultPrevented).toBe(true);
  });

  it('貼上：超出表格的列忽略、不可編輯的欄位略過、與原值相同的不回報', () => {
    const onCellsChange = vi.fn();
    render(
      <DataGrid
        columns={[
          { key: 'email', name: 'Email' },
          { key: 'code', name: '代碼', editable: false },
          { key: 'name', name: '名稱' },
        ]}
        rows={[
          { key: 1, cells: { email: 'a@x', code: 'c1', name: 'A' } },
          { key: 2, cells: { email: 'b@x', code: 'c2', name: 'B' } },
        ]}
        onCellsChange={onCellsChange}
        aria-label="預覽"
      />,
    );
    const cell = selectCell('b@x');

    paste(cell, 'new@x\tzz\tB\nignored\tzz\tC');

    expect(onCellsChange).toHaveBeenCalledWith([{ rowIndex: 1, key: 'email', value: 'new@x' }]);
  });

  it('貼上的內容與原值完全相同時不回報', () => {
    const onCellsChange = vi.fn();
    render(
      <DataGrid columns={columns} rows={rows} onCellsChange={onCellsChange} aria-label="預覽" />,
    );

    paste(selectCell('bad'), 'bad');

    expect(onCellsChange).not.toHaveBeenCalled();
  });

  it('文字編輯：輸入後離開輸入框寫回；值沒變不回報', () => {
    const onCellsChange = vi.fn();
    const { rerender } = render(
      <DataGrid columns={columns} rows={rows} onCellsChange={onCellsChange} aria-label="預覽" />,
    );
    editCell('bad');
    const input = screen.getByRole('textbox', { name: 'Email' });
    fireEvent.change(input, { target: { value: 'fixed@example.com' } });
    fireEvent.blur(input);
    expect(onCellsChange).toHaveBeenCalledWith([
      { rowIndex: 0, key: 'email', value: 'fixed@example.com' },
    ]);

    onCellsChange.mockClear();
    rerender(
      <DataGrid columns={columns} rows={rows} onCellsChange={onCellsChange} aria-label="預覽" />,
    );
    editCell('b@example.com');
    fireEvent.blur(screen.getByRole('textbox', { name: 'Email' }));
    expect(onCellsChange).not.toHaveBeenCalled();
  });

  it('renderValue 自訂顯示；不可編輯的欄位雙擊不進入編輯', () => {
    render(
      <DataGrid
        columns={[
          {
            key: 'email',
            name: 'Email',
            editable: false,
            renderValue: (value) => <strong>{value.toUpperCase()}</strong>,
          },
        ]}
        rows={[{ key: 1, cells: { email: 'a@x' } }]}
        onCellsChange={vi.fn()}
        aria-label="預覽"
      />,
    );

    editCell('A@X');

    expect(screen.getByText('A@X').tagName).toBe('STRONG');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('有 selectedRows 與 onSelectedRowsChange 時多一個勾選欄，勾選以列的 key 回報', () => {
    const onSelectedRowsChange = vi.fn();
    render(
      <DataGrid
        columns={columns}
        rows={rows}
        selectedRows={new Set()}
        onSelectedRowsChange={onSelectedRowsChange}
        aria-label="預覽"
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    // 表頭全選 ＋ 每一列一個
    expect(checkboxes).toHaveLength(3);

    fireEvent.click(checkboxes[2]!);

    expect(onSelectedRowsChange).toHaveBeenCalledWith(new Set([2]));
  });

  describe('下拉選單編輯器', () => {
    it('rowOptions 讓目前的值顯示名稱，不在任何選項裡的值也列出來', async () => {
      render(
        <DataGrid
          columns={[
            {
              key: 'owner',
              name: '負責人',
              rowOptions: () => [{ value: 'u-1', label: 'Alice', description: 'alice@x' }],
            },
          ]}
          rows={[
            { key: 1, cells: { owner: 'u-1' } },
            { key: 2, cells: { owner: 'unknown' } },
          ]}
          onCellsChange={vi.fn()}
          aria-label="預覽"
        />,
      );

      editCell('unknown');

      expect(await screen.findByRole('option', { name: /Alice/ })).toHaveTextContent('alice@x');
      expect(screen.getByRole('option', { name: 'unknown' })).toBeInTheDocument();
    });

    it('遠端查詢失敗時清單是空的，不會卡在載入中', async () => {
      const loadOptions = vi.fn().mockRejectedValue(new Error('network'));
      render(
        <DataGrid
          columns={[{ key: 'role', name: '角色', loadOptions }]}
          rows={[
            { key: 1, cells: { role: '' } },
            { key: 2, cells: { role: 'r-1' } },
          ]}
          onCellsChange={vi.fn()}
          aria-label="預覽"
        />,
      );

      editCell('r-1');

      await vi.waitFor(() => expect(loadOptions).toHaveBeenCalledWith(''));
      const options = await screen.findAllByRole('option');
      expect(options.map((option) => option.textContent)).toEqual(['r-1']);
    });

    it('輸入關鍵字後去抖動再查詢，只套用最後一次的結果', async () => {
      const loadOptions = vi.fn(async (keyword: string) =>
        keyword ? [{ value: keyword, label: `結果 ${keyword}` }] : [],
      );
      render(
        <DataGrid
          columns={[{ key: 'role', name: '角色', loadOptions }]}
          rows={[{ key: 1, cells: { role: 'r-1' } }]}
          onCellsChange={vi.fn()}
          aria-label="預覽"
        />,
      );
      editCell('r-1');
      const search = await screen.findByTestId('select-search');

      fireEvent.change(search, { target: { value: 'ab' } });
      fireEvent.change(search, { target: { value: 'abc' } });

      expect(await screen.findByRole('option', { name: '結果 abc' })).toBeInTheDocument();
      expect(loadOptions).not.toHaveBeenCalledWith('ab');
    });

    it('Esc 收合下拉選單：不寫回', async () => {
      const onCellsChange = vi.fn();
      render(
        <DataGrid
          columns={[
            {
              key: 'status',
              name: '狀態',
              options: [{ value: '啟用', label: '啟用' }],
            },
          ]}
          rows={[{ key: 1, cells: { status: '啟用' } }]}
          onCellsChange={onCellsChange}
          aria-label="預覽"
        />,
      );
      editCell('啟用');

      fireEvent.keyDown(await screen.findByRole('option', { name: '啟用' }), { key: 'Escape' });

      expect(onCellsChange).not.toHaveBeenCalled();
    });
  });

  describe('自動完成編輯器', () => {
    function renderAutocomplete(loadSuggestions: (keyword: string) => Promise<readonly string[]>) {
      const onCellsChange = vi.fn();
      render(
        <DataGrid
          columns={[{ key: 'email', name: 'Email', loadSuggestions }]}
          rows={[{ key: 1, cells: { email: 'old' } }]}
          onCellsChange={onCellsChange}
          aria-label="預覽"
        />,
      );
      editCell('old');
      return { onCellsChange, input: screen.getByRole('combobox', { name: 'Email' }) };
    }

    it('與輸入值相同的建議不列出', async () => {
      const { input } = renderAutocomplete(async () => ['same', 'same-other']);

      fireEvent.change(input, { target: { value: 'Same' } });

      expect(await screen.findByRole('option', { name: 'same-other' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'same' })).not.toBeInTheDocument();
    });

    it('↑ 從「沒有選」循環到最後一個；↓ 超過最後一個回到「沒有選」', async () => {
      const { input } = renderAutocomplete(async () => ['a1', 'a2']);
      fireEvent.change(input, { target: { value: 'a' } });
      const [first, second] = await screen.findAllByRole('option');

      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(input).toHaveAttribute('aria-activedescendant', second!.id);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input).not.toHaveAttribute('aria-activedescendant');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input).toHaveAttribute('aria-activedescendant', first!.id);
    });

    it('Esc 只收起建議，不結束編輯', async () => {
      const { input } = renderAutocomplete(async () => ['a1']);
      fireEvent.change(input, { target: { value: 'a' } });
      await screen.findByRole('option', { name: 'a1' });

      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByTestId('data-grid-suggestions')).not.toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Email' })).toBeInTheDocument();
    });

    it('點選建議就採用並寫回', async () => {
      const { input, onCellsChange } = renderAutocomplete(async () => ['a1@x']);
      fireEvent.change(input, { target: { value: 'a' } });
      const option = await screen.findByRole('option', { name: 'a1@x' });

      act(() => {
        fireEvent.click(option);
      });

      expect(onCellsChange).toHaveBeenCalledWith([{ rowIndex: 0, key: 'email', value: 'a1@x' }]);
    });

    it('查詢失敗時不顯示建議，仍可以輸入任意文字', async () => {
      const loadSuggestions = vi.fn().mockRejectedValue(new Error('network'));
      const { input } = renderAutocomplete(loadSuggestions);

      fireEvent.change(input, { target: { value: 'free text' } });

      await vi.waitFor(() => expect(loadSuggestions).toHaveBeenCalledWith('free text'));
      expect(screen.queryByTestId('data-grid-suggestions')).not.toBeInTheDocument();
      expect(input).toHaveValue('free text');
    });
  });
});
