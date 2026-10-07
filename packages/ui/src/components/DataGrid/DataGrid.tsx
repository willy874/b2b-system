import 'react-data-grid/lib/styles.css';
import { cn } from '@b2b-system/web-shared/utils';
import { useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, Key, ReactNode, Ref } from 'react';
import { DataGrid as Grid, SelectColumn } from 'react-data-grid';
import type {
  CellCopyArgs,
  CellKeyDownArgs,
  CellKeyboardEvent,
  Column,
  DataGridHandle,
  RenderEditCellProps,
  RowsChangeData,
} from 'react-data-grid';

import styles from './DataGrid.module.css';

/** 儲存格的狀態：錯誤、警告、有變更、沒有變更、驗證中。 */
export type DataGridCellTone = 'error' | 'warning' | 'changed' | 'unchanged' | 'pending';

export interface DataGridCellState {
  tone?: DataGridCellTone;
  /** 滑過或聚焦時的說明（錯誤訊息、原值）；也是報讀器念的描述。 */
  message?: string;
}

export interface DataGridOption {
  value: string;
  label: string;
}

export interface DataGridColumn {
  key: string;
  name: string;
  /** 表頭的提示（格式、選項、補充說明）。 */
  description?: string;
  required?: boolean;
  width?: number;
  /** 預設可以編輯。 */
  editable?: boolean;
  /** 固定選項：編輯器是下拉選單。 */
  options?: readonly DataGridOption[];
  /** 動態建議：編輯時依輸入查詢（例：遠端搜尋）。 */
  loadSuggestions?: (keyword: string) => Promise<readonly string[]>;
  /** 自訂顯示；沒有就顯示原始字串。 */
  renderValue?: (value: string, row: DataGridRow) => ReactNode;
}

/** 一列：`cells` 是原始字串，狀態與列首由呼叫端算好傳進來（DataGrid 是受控元件）。 */
export interface DataGridRow {
  key: Key;
  cells: Readonly<Record<string, string>>;
  states?: Readonly<Record<string, DataGridCellState>>;
  /** 凍結在左側的列首內容（列號、狀態圖示）。 */
  header?: ReactNode;
  /** 整列的狀態（列首的色條）。 */
  tone?: DataGridCellTone;
}

export interface DataGridCellChange {
  rowIndex: number;
  key: string;
  value: string;
}

export interface DataGridLabels {
  /** 列首欄的名稱。 */
  rowHeader: string;
  /** 必填標記給報讀器的文字。 */
  required: string;
}

const DEFAULT_LABELS: DataGridLabels = { rowHeader: '#', required: '必填' };

export interface DataGridProps {
  /** 透傳到根元素。 */
  ref?: Ref<HTMLDivElement>;
  columns: readonly DataGridColumn[];
  rows: readonly DataGridRow[];
  /** 編輯、貼上、清除都合併成一次呼叫：一次貼上是一次變更（呼叫端只送一次驗證）。 */
  onCellsChange?: (changes: DataGridCellChange[]) => void;
  /** Ctrl＋Z／Ctrl＋Shift＋Z（Ctrl＋Y）。 */
  onUndo?: () => void;
  onRedo?: () => void;
  /** 列的勾選（列的 key）；沒有給就沒有勾選欄。 */
  selectedRows?: ReadonlySet<Key>;
  onSelectedRowsChange?: (keys: Set<Key>) => void;
  rowHeaderWidth?: number;
  labels?: Partial<DataGridLabels>;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

const TONE_CLASS = {
  error: styles.error,
  warning: styles.warning,
  changed: styles.changed,
  unchanged: styles.unchanged,
  pending: styles.pending,
} as const satisfies Record<DataGridCellTone, string | undefined>;

/** 從 Excel 複製的範圍是 TSV：列以換行、欄以 Tab 分隔；引號包住的欄位可以含換行。 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === '\t') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function TextEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<DataGridRow>) {
  return (
    <input
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- 試算表的編輯器：進入編輯時焦點就在輸入框
      autoFocus
      className={styles.editor}
      value={row.cells[column.key] ?? ''}
      aria-label={typeof column.name === 'string' ? column.name : column.key}
      onChange={(event) =>
        onRowChange({ ...row, cells: { ...row.cells, [column.key]: event.target.value } })
      }
      onBlur={() => onClose(true, false)}
    />
  );
}

function OptionsEditor({
  options,
  ...props
}: RenderEditCellProps<DataGridRow> & { options: readonly DataGridOption[] }) {
  const { row, column, onRowChange } = props;
  const value = row.cells[column.key] ?? '';
  const known = options.some((option) => option.label === value || option.value === value);
  return (
    <select
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- 同 TextEditor
      autoFocus
      className={styles.editor}
      value={value}
      aria-label={typeof column.name === 'string' ? column.name : column.key}
      onChange={(event) =>
        onRowChange({ ...row, cells: { ...row.cells, [column.key]: event.target.value } }, true)
      }
    >
      <option value="">—</option>
      {!known && value && <option value={value}>{value}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.label}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function SuggestEditor({
  loadSuggestions,
  ...props
}: RenderEditCellProps<DataGridRow> & {
  loadSuggestions: (keyword: string) => Promise<readonly string[]>;
}) {
  const { row, column, onRowChange, onClose } = props;
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const listId = `data-grid-suggest-${String(row.key)}-${column.key}`;
  const value = row.cells[column.key] ?? '';
  // 只套用最後一次查詢的結果（輸入很快時，先發出的查詢可能後回來）
  const latest = useRef('');
  return (
    <>
      <input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- 同 TextEditor
        autoFocus
        className={styles.editor}
        value={value}
        list={listId}
        aria-label={typeof column.name === 'string' ? column.name : column.key}
        onChange={(event) => {
          const next = event.target.value;
          onRowChange({ ...row, cells: { ...row.cells, [column.key]: next } });
          // 多值以 ; 分隔：只對最後一段查詢
          const keyword = next.split(';').at(-1)?.trim() ?? '';
          latest.current = keyword;
          void loadSuggestions(keyword).then(
            (items) => {
              if (latest.current === keyword) setSuggestions(items);
            },
            () => setSuggestions([]),
          );
        }}
        onBlur={() => onClose(true, false)}
      />
      <datalist id={listId}>
        {suggestions.map((item) => (
          <option
            key={item}
            value={[...value.split(';').slice(0, -1), item].map((part) => part.trim()).join(';')}
          >
            {item}
          </option>
        ))}
      </datalist>
    </>
  );
}

/**
 * 試算表式的表格（docs/architecture/frontend/21-data-transfer.md §3）：列與欄都虛擬捲動、方向鍵與 Tab 移動、
 * Enter／F2 編輯、Esc 取消、Delete 清空、F8 跳到下一個錯誤、Ctrl＋C 複製目前的儲存格、Ctrl＋V 貼上 TSV 範圍（可以直接從 Excel 貼過來）。
 *
 * 受控元件：列、欄、儲存格狀態都由 props 傳入，變更以 `onCellsChange` 回報；底層是 `react-data-grid`，
 * 型別不外露（之後換實作只動這個資料夾）。平常每一格是唯讀的顯示元件，只有正在編輯的那一格掛上輸入元件。
 */
export function DataGrid({
  ref,
  columns,
  rows,
  onCellsChange,
  onUndo,
  onRedo,
  selectedRows,
  onSelectedRowsChange,
  rowHeaderWidth = 72,
  labels,
  className,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: DataGridProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const gridRef = useRef<DataGridHandle>(null);
  const selectable = Boolean(selectedRows && onSelectedRowsChange);
  /** 欄位在底層表格裡的位置：勾選欄、列首欄在最前面。 */
  const offset = (selectable ? 1 : 0) + 1;

  const gridColumns = useMemo<Column<DataGridRow>[]>(() => {
    const header: Column<DataGridRow> = {
      key: '__rowHeader',
      name: text.rowHeader,
      width: rowHeaderWidth,
      frozen: true,
      editable: false,
      cellClass: (row) => cn(styles.rowHeader, row.tone && TONE_CLASS[row.tone]),
      renderCell: ({ row }) => row.header,
    };
    const data = columns.map<Column<DataGridRow>>((column) => ({
      key: column.key,
      name: column.name,
      width: column.width ?? 160,
      resizable: true,
      editable: column.editable !== false && Boolean(onCellsChange),
      cellClass: (row) => {
        const tone = row.states?.[column.key]?.tone;
        return cn(styles.cell, tone && TONE_CLASS[tone]);
      },
      renderHeaderCell: () => (
        <span className={styles.header} title={column.description}>
          {column.name}
          {column.required && (
            <span className={styles.required}>
              <span aria-hidden="true">*</span>
              <span className={styles.srOnly}>{text.required}</span>
            </span>
          )}
        </span>
      ),
      renderCell: ({ row }) => {
        const value = row.cells[column.key] ?? '';
        const state = row.states?.[column.key];
        return (
          <span
            className={styles.value}
            title={state?.message}
            aria-invalid={state?.tone === 'error' || undefined}
            data-tone={state?.tone}
          >
            {column.renderValue ? column.renderValue(value, row) : value}
          </span>
        );
      },
      renderEditCell: (props) => {
        if (column.options) return <OptionsEditor {...props} options={column.options} />;
        if (column.loadSuggestions)
          return <SuggestEditor {...props} loadSuggestions={column.loadSuggestions} />;
        return <TextEditor {...props} />;
      },
    }));
    return selectable ? [SelectColumn as Column<DataGridRow>, header, ...data] : [header, ...data];
  }, [columns, onCellsChange, rowHeaderWidth, selectable, text.required, text.rowHeader]);

  const handleRowsChange = (next: DataGridRow[], data: RowsChangeData<DataGridRow>) => {
    if (!onCellsChange) return;
    const key = data.column.key;
    const changes = data.indexes.flatMap((rowIndex) => {
      const value = next[rowIndex]?.cells[key] ?? '';
      return value === (rows[rowIndex]?.cells[key] ?? '') ? [] : [{ rowIndex, key, value }];
    });
    if (changes.length) onCellsChange(changes);
  };

  /** F8：從目前位置往後找下一個錯誤（到底再從頭）。 */
  const jumpToNextError = (rowIdx: number, idx: number) => {
    const total = rows.length * columns.length;
    const start = Math.max(0, rowIdx) * columns.length + Math.max(0, idx - offset);
    for (let step = 1; step <= total; step += 1) {
      const position = (start + step) % total;
      const rowIndex = Math.floor(position / columns.length);
      const column = columns[position % columns.length];
      if (column && rows[rowIndex]?.states?.[column.key]?.tone === 'error') {
        gridRef.current?.setActivePosition({
          rowIdx: rowIndex,
          idx: (position % columns.length) + offset,
        });
        return;
      }
    }
  };

  const handleKeyDown = (args: CellKeyDownArgs<DataGridRow>, event: CellKeyboardEvent) => {
    if (args.mode !== 'ACTIVE') return;
    const modifier = event.ctrlKey || event.metaKey;
    if (event.key === 'F8') {
      event.preventGridDefault();
      event.preventDefault();
      jumpToNextError(
        args.rowIdx,
        args.column ? gridColumns.indexOf(args.column as Column<DataGridRow>) : 0,
      );
      return;
    }
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventGridDefault();
      event.preventDefault();
      (event.shiftKey ? onRedo : onUndo)?.();
      return;
    }
    if (modifier && event.key.toLowerCase() === 'y') {
      event.preventGridDefault();
      event.preventDefault();
      onRedo?.();
      return;
    }
    const column = args.column;
    const editable = column && columns.find((item) => item.key === column.key)?.editable !== false;
    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      column &&
      editable &&
      onCellsChange
    ) {
      event.preventGridDefault();
      if ((rows[args.rowIdx]?.cells[column.key] ?? '') !== '') {
        onCellsChange([{ rowIndex: args.rowIdx, key: column.key, value: '' }]);
      }
    }
  };

  const handleCopy = (
    { row, column }: CellCopyArgs<DataGridRow>,
    event: ClipboardEvent<HTMLDivElement>,
  ) => {
    event.clipboardData.setData('text/plain', row.cells[column.key] ?? '');
    event.preventDefault();
  };

  /** 貼上：TSV 範圍以目前儲存格為左上角，超出表格的部分忽略；不可編輯的欄位略過。 */
  const handlePaste = (
    { row, column }: CellCopyArgs<DataGridRow>,
    event: ClipboardEvent<HTMLDivElement>,
  ): DataGridRow => {
    event.preventDefault();
    if (!onCellsChange) return row;
    const startRow = rows.indexOf(row);
    const startColumn = columns.findIndex((item) => item.key === column.key);
    if (startRow < 0 || startColumn < 0) return row;
    const grid = parseTsv(event.clipboardData.getData('text/plain'));
    const changes: DataGridCellChange[] = [];
    grid.forEach((values, rowOffset) => {
      const rowIndex = startRow + rowOffset;
      if (rowIndex >= rows.length) return;
      values.forEach((value, columnOffset) => {
        const target = columns[startColumn + columnOffset];
        if (!target || target.editable === false) return;
        if ((rows[rowIndex]?.cells[target.key] ?? '') !== value) {
          changes.push({ rowIndex, key: target.key, value });
        }
      });
    });
    if (changes.length) onCellsChange(changes);
    return row;
  };

  return (
    <div ref={ref} className={cn(styles.root, className)} data-testid={testId}>
      <Grid<DataGridRow, unknown, Key>
        ref={gridRef}
        className={styles.grid}
        aria-label={ariaLabel}
        columns={gridColumns}
        rows={rows}
        rowKeyGetter={(row) => row.key}
        rowHeight={34}
        headerRowHeight={36}
        onRowsChange={handleRowsChange}
        onCellKeyDown={handleKeyDown}
        onCellCopy={handleCopy}
        onCellPaste={handlePaste}
        selectedRows={selectedRows}
        onSelectedRowsChange={onSelectedRowsChange}
      />
    </div>
  );
}
