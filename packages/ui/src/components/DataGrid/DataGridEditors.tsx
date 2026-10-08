import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { RenderEditCellProps } from 'react-data-grid';
import { createPortal } from 'react-dom';

import { Select } from '../Select';
import type { SelectOption } from '../Select';
import type { DataGridOption, DataGridRow } from './DataGrid';

import styles from './DataGrid.module.css';

/** 遠端查詢（選項、自動完成）的去抖動間隔。 */
const LOAD_DEBOUNCE_MS = 200;

function nameOf(column: RenderEditCellProps<DataGridRow>['column']): string {
  return typeof column.name === 'string' ? column.name : column.key;
}

/** 多值儲存格的拆分：去頭尾空白、去掉空的部分。 */
export function splitCellValues(text: string, separator: string): string[] {
  return text
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function TextEditor({
  row,
  column,
  onRowChange,
  onClose,
}: RenderEditCellProps<DataGridRow>) {
  return (
    <input
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- 試算表的編輯器：進入編輯時焦點就在輸入框
      autoFocus
      className={styles.editor}
      value={row.cells[column.key] ?? ''}
      aria-label={nameOf(column)}
      onChange={(event) =>
        onRowChange({ ...row, cells: { ...row.cells, [column.key]: event.target.value } })
      }
      onBlur={() => onClose(true, false)}
    />
  );
}

export interface SelectEditorConfig {
  /** 固定選項。 */
  options?: readonly DataGridOption[];
  /** 這一列特有的選項（例：目前的值不在查詢結果裡時，讓下拉選單仍顯示它的名稱）。 */
  rowOptions?: (row: DataGridRow) => readonly DataGridOption[];
  /** 遠端選項：打開時與輸入關鍵字時查詢；有它時不在本地過濾。 */
  loadOptions?: (keyword: string) => Promise<readonly DataGridOption[]>;
  /** 多選：儲存格以 `separator` 串接選取的值。 */
  multiple?: boolean;
  separator: string;
}

/** 合併選項，同一個值以先出現的為準；儲存格中不在任何選項裡的值也列出來（標籤就是值本身）。 */
function mergeOptions(
  values: readonly string[],
  ...groups: ReadonlyArray<readonly DataGridOption[] | undefined>
): SelectOption<string>[] {
  const seen = new Map<string, SelectOption<string>>();
  for (const group of groups) {
    for (const option of group ?? []) {
      if (!seen.has(option.value)) {
        seen.set(option.value, {
          value: option.value,
          label: option.label,
          ...(option.description ? { description: option.description } : {}),
        });
      }
    }
  }
  for (const value of values) {
    if (!seen.has(value)) seen.set(value, { value, label: value });
  }
  return [...seen.values()];
}

/**
 * 下拉選單的編輯器：把專案的 `Select` 包成儲存格的樣子（沒有外框與圓角、填滿儲存格），功能與 `Select` 相同——
 * 搜尋、虛擬捲動、多選、遠端查詢。進入編輯時直接展開；單選選完就寫回並結束編輯，多選在收合時寫回。
 */
export function SelectEditor({
  config,
  ...props
}: RenderEditCellProps<DataGridRow> & { config: SelectEditorConfig }) {
  const { row, column, onRowChange, onClose } = props;
  const raw = row.cells[column.key] ?? '';
  const values = config.multiple
    ? splitCellValues(raw, config.separator)
    : raw.trim()
      ? [raw.trim()]
      : [];
  const [loaded, setLoaded] = useState<readonly DataGridOption[]>([]);
  const [loading, setLoading] = useState(Boolean(config.loadOptions));
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadOptions = config.loadOptions;
  const closing = useRef(false);

  /** 只套用最後一次查詢的結果（輸入很快時，先發出的查詢可能後回來）。 */
  const fetchOptions = (keyword: string) => {
    if (!loadOptions) return;
    const request = latest.current + 1;
    latest.current = request;
    void loadOptions(keyword).then(
      (items) => {
        if (latest.current !== request) return;
        setLoaded(items);
        setLoading(false);
      },
      () => {
        if (latest.current !== request) return;
        setLoaded([]);
        setLoading(false);
      },
    );
  };
  const fetchRef = useRef(fetchOptions);
  // 進入編輯（下拉選單展開）的當下查第一頁，不帶關鍵字
  useEffect(() => {
    fetchRef.current('');
    return () => {
      latest.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const options = mergeOptions(values, config.rowOptions?.(row), config.options, loaded);
  const searchable = Boolean(config.loadOptions) || options.length > 8;
  const write = (next: readonly string[], commit: boolean) =>
    onRowChange(
      { ...row, cells: { ...row.cells, [column.key]: next.join(config.separator) } },
      commit,
    );
  const common = {
    options,
    defaultOpen: true,
    size: 'sm' as const,
    searchable,
    ...(config.loadOptions ? { filterOption: false as const, loading } : {}),
    onSearchChange: (keyword: string) => {
      // 收合時 Select 會清空搜尋字：編輯要結束了，不必再查
      if (!loadOptions || closing.current) return;
      if (timer.current) clearTimeout(timer.current);
      setLoading(true);
      timer.current = setTimeout(() => fetchOptions(keyword.trim()), LOAD_DEBOUNCE_MS);
    },
    // 收合就結束編輯
    onOpenChange: (open: boolean) => {
      if (open) return;
      closing.current = true;
      onClose(true, false);
    },
    className: styles.selectTrigger,
    'aria-label': nameOf(column),
  };

  return (
    // 選單裡的 Enter 與方向鍵由 Select 處理，不要讓表格也處理一次；Tab 寫回並結束編輯
    // （搜尋框在 portal 裡，表格不把它當成編輯器，不會處理 Tab）
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className={styles.selectEditor}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          closing.current = true;
          onClose(true, true);
        } else if (event.key === 'Enter' || event.key.startsWith('Arrow')) {
          event.stopPropagation();
        }
      }}
    >
      {config.multiple ? (
        <Select<string>
          {...common}
          multiple
          value={values}
          onValueChange={(next) => write(next, false)}
        />
      ) : (
        <Select<string>
          {...common}
          value={values[0] ?? null}
          onValueChange={(next) => {
            closing.current = true;
            write(next ? [next] : [], true);
          }}
        />
      )}
    </div>
  );
}

/**
 * 文字欄的自動完成：照常輸入任意文字，輸入時在下方列出建議；↑↓ 選擇、Enter 採用、Esc 收起建議。
 * 建議清單以 portal 放在 body（儲存格會裁切超出的內容），位置在輸入時依輸入框計算。
 */
export function AutocompleteEditor({
  loadSuggestions,
  ...props
}: RenderEditCellProps<DataGridRow> & {
  loadSuggestions: (keyword: string) => Promise<readonly string[]>;
}) {
  const { row, column, onRowChange, onClose } = props;
  const value = row.cells[column.key] ?? '';
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [items, setItems] = useState<readonly string[]>([]);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const open = position !== null && items.length > 0;
  // 結束編輯時取消還沒送出的查詢
  useEffect(
    () => () => {
      latest.current += 1;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const close = () => {
    latest.current += 1;
    setPosition(null);
    setActive(-1);
  };

  const query = (keyword: string) => {
    if (timer.current) clearTimeout(timer.current);
    const request = latest.current + 1;
    latest.current = request;
    timer.current = setTimeout(() => {
      void loadSuggestions(keyword).then(
        (found) => {
          if (latest.current !== request) return;
          const rect = inputRef.current?.getBoundingClientRect();
          const wanted = keyword.trim().toLowerCase();
          setItems(found.filter((item) => item.toLowerCase() !== wanted));
          setActive(-1);
          setPosition(
            rect ? { top: rect.bottom + 2, left: rect.left, minWidth: rect.width } : null,
          );
        },
        () => {
          if (latest.current === request) close();
        },
      );
    }, LOAD_DEBOUNCE_MS);
  };

  const pick = (item: string) => {
    close();
    onRowChange({ ...row, cells: { ...row.cells, [column.key]: item } }, true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // 在「沒有選」（-1）與各個建議之間循環
      setActive((current) => {
        const next = current + step;
        if (next < -1) return items.length - 1;
        return next >= items.length ? -1 : next;
      });
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      event.stopPropagation();
      const item = items[active];
      if (item !== undefined) pick(item);
    } else if (event.key === 'Escape') {
      // 第一次 Esc 只收起建議；再按一次才取消編輯
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- 同 TextEditor
        autoFocus
        className={styles.editor}
        value={value}
        role="combobox"
        aria-label={nameOf(column)}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value;
          onRowChange({ ...row, cells: { ...row.cells, [column.key]: next } });
          query(next.trim());
        }}
        onKeyDown={onKeyDown}
        onBlur={() => onClose(true, false)}
      />
      {open &&
        position &&
        createPortal(
          <div
            id={listId}
            // 原生的 datalist 無法設定樣式、也不能以方向鍵選取後由程式寫回：自訂清單＋aria-activedescendant
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="listbox"
            aria-label={nameOf(column)}
            className={styles.suggestions}
            style={position}
            data-testid="data-grid-suggestions"
          >
            {items.map((item, index) => (
              // 選項以滑鼠點選；鍵盤操作在輸入框上（aria-activedescendant）
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
              <div
                key={item}
                id={`${listId}-${index}`}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                className={styles.suggestion}
                data-active={index === active || undefined}
                // 按下時不讓輸入框失焦（失焦會結束編輯）
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(item)}
              >
                {item}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
