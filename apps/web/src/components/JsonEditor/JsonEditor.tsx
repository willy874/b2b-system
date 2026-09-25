import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { Button, IconButton } from '../Button';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { DEFAULT_JSON_MAX_HEIGHT } from '../JsonViewer';
import type { JsonViewerLabels, JsonViewerSlot } from '../JsonViewer';
import { formatPath, parsePath } from '../JsonViewer/jsonLines';
import type { JsonLine, JsonPath } from '../JsonViewer/jsonLines';
import { searchJson } from '../JsonViewer/jsonSearch';
import { highlightText, JSON_PRIMITIVE_CLASS, JsonTree } from '../JsonViewer/JsonTree';
import type { JsonLineAnnotation } from '../JsonViewer/JsonTree';
import { useJsonTree } from '../JsonViewer/useJsonTree';
import { Menu } from '../Menu';
import type { MenuItemDescriptor } from '../Menu';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Tooltip } from '../Tooltip';
import { useControllableState } from '../useControllableState';
import { useLatestRef } from '../useLatestRef';
import {
  appendChild,
  convert,
  duplicate,
  fromEditText,
  getIn,
  hasKey,
  insertAfter,
  removeIn,
  renameKey,
  setIn,
  toEditText,
} from './jsonEdit';
import type { InsertResult, JsonConvertTarget } from './jsonEdit';
import { JsonSearchBar } from './JsonSearchBar';
import { useJsonHistory } from './useJsonHistory';
import { useJsonValidation } from './useJsonValidation';
import type { JsonValidationError, JsonValidator } from './validation';
import { ValidationPanel } from './ValidationPanel';

import styles from './JsonEditor.module.css';

export type JsonEditorMode = 'tree' | 'text';

/** `className` / `data-testid` 落在最外層；樹狀區沿用 `JsonViewerSlot`，其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type JsonEditorSlot =
  | JsonViewerSlot
  | 'toolbar'
  | 'search'
  | 'textarea'
  | 'error'
  | 'input'
  | 'validation';

export interface JsonEditorLabels extends JsonViewerLabels {
  tree?: string;
  text?: string;
  expandAll?: string;
  collapseAll?: string;
  format?: string;
  compact?: string;
  undo?: string;
  redo?: string;
  /** 每一行的操作選單按鈕。 */
  actions?: string;
  editKey?: string;
  editValue?: string;
  insertAfter?: string;
  addChild?: string;
  duplicate?: string;
  convertToObject?: string;
  convertToArray?: string;
  convertToValue?: string;
  remove?: string;
  /** 改鍵名時與同層的鍵重複。 */
  duplicateKey?: string;
  /** 文字模式的內容不是合法 JSON；後面接瀏覽器的錯誤訊息。 */
  parseError?: string;
  search?: string;
  searchPlaceholder?: string;
  previousMatch?: string;
  nextMatch?: string;
  closeSearch?: string;
  noMatch?: string;
  /** 搜尋結果的位置，例如「2 / 5」。 */
  matchCount?: (active: number, total: number) => string;
  /** 驗證錯誤清單的標題，例如「3 個驗證錯誤」。 */
  validationErrors?: (count: number) => string;
  /** 驗證錯誤清單裡根節點的名稱。 */
  rootPath?: string;
}

export interface JsonEditorProps extends SlotOverrides<JsonEditorSlot> {
  /** 透傳到最外層（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  /** 受控的值；編輯時以 `onChange` 回報整份新值（不可變，未改到的子樹沿用原參考）。 */
  value?: unknown;
  defaultValue?: unknown;
  onChange?: (value: unknown) => void;
  mode?: JsonEditorMode;
  defaultMode?: JsonEditorMode;
  onModeChange?: (mode: JsonEditorMode) => void;
  /** 只能看、切換模式與收合，不能改。 */
  readOnly?: boolean;
  /** 樹狀模式的最大高度、文字模式的高度（預設 `20rem`）。 */
  maxHeight?: CSSProperties['maxHeight'];
  /** 這個深度（含）以下的物件／陣列一開始是收合的；根節點深度為 0。預設全部展開。 */
  defaultExpandDepth?: number;
  /** 行數超過這個值才虛擬捲動。預設 100。 */
  virtualThreshold?: number;
  /**
   * 驗證：錯誤的行標紅、收合的上層顯示標記，編輯區下方列出錯誤（點一下跳過去）。
   * JSON Schema 用 `createJsonSchemaValidator(schema)`；請保持參考固定（模組層級或 `useMemo`），改變時會重新驗證。
   */
  validator?: JsonValidator;
  /** 驗證結果改變時通知（例如在錯誤未清空前停用送出鈕）。 */
  onValidationChange?: (errors: readonly JsonValidationError[]) => void;
  /** 預設文案是繁中；`features/` 使用時以 `t()` 傳入。 */
  labels?: JsonEditorLabels;
  className?: string;
  style?: CSSProperties;
  /** 編輯區（樹狀捲動框、文字框）的名稱。 */
  'aria-label'?: string;
  'data-testid'?: string;
}

const DEFAULT_LABELS = {
  tree: '樹狀',
  text: '文字',
  expandAll: '全部展開',
  collapseAll: '全部收合',
  format: '格式化',
  compact: '壓縮',
  undo: '復原',
  redo: '重做',
  actions: '操作',
  editKey: '編輯鍵名',
  editValue: '編輯值',
  insertAfter: '在下方插入',
  addChild: '新增子項',
  duplicate: '複製一份',
  convertToObject: '轉成物件',
  convertToArray: '轉成陣列',
  convertToValue: '轉成值',
  remove: '刪除',
  duplicateKey: '鍵名重複',
  parseError: '不是合法的 JSON',
  search: '搜尋',
  searchPlaceholder: '搜尋鍵名或值',
  previousMatch: '上一個',
  nextMatch: '下一個',
  closeSearch: '關閉搜尋',
  noMatch: '沒有符合的結果',
  matchCount: (active: number, total: number) => `${active} / ${total}`,
  validationErrors: (count: number) => `${count} 個驗證錯誤`,
  rootPath: '（根）',
} satisfies Required<Omit<JsonEditorLabels, keyof JsonViewerLabels>>;

/** 新增的物件鍵名；重複時接數字（`newKey1`）。 */
const NEW_KEY = 'newKey';
/** 新增節點的初始值：空字串，接著直接進入編輯。 */
const NEW_VALUE = '';

/** `defaultValue` 的預設；固定參考，不會每次 render 都是新物件。 */
const EMPTY_OBJECT = {};

const MODES = ['tree', 'text'] as const satisfies readonly JsonEditorMode[];

interface SearchState {
  isOpen: boolean;
  query: string;
  /** 目前是第幾筆；資料改變使筆數變少時會被夾到最後一筆。 */
  index: number;
}

const CLOSED_SEARCH: SearchState = { isOpen: false, query: '', index: 0 };

/** 驗證錯誤 → 行的標記：錯誤所在的行，以及它每一層上層（收合時提示裡面有錯）。 */
function toAnnotations(
  errors: readonly JsonValidationError[],
): ReadonlyMap<string, JsonLineAnnotation> {
  const messages = new Map<string, string[]>();
  for (const error of errors) {
    const path = formatPath(error.path);
    messages.set(path, [...(messages.get(path) ?? []), error.message]);
  }
  const annotations = new Map<string, JsonLineAnnotation>();
  for (const [path, list] of messages) annotations.set(path, { errors: list });
  for (const error of errors) {
    for (let depth = 0; depth < error.path.length; depth += 1) {
      const ancestor = formatPath(error.path.slice(0, depth));
      if (!annotations.has(ancestor)) annotations.set(ancestor, { nested: true });
    }
  }
  return annotations;
}

interface EditingTarget {
  path: string;
  target: 'key' | 'value';
  /** 新插入的物件成員：鍵名送出後接著編輯值（與 svelte-jsoneditor 相同）。 */
  thenValue?: boolean;
}

interface TextDraft {
  text: string;
  /** 這份草稿對應的值；值被其他操作（復原、外部更新）換掉時，草稿改從新值重新產生。 */
  source: unknown;
  error: string | undefined;
}

const stringify = (value: unknown, compact = false) =>
  JSON.stringify(value, null, compact ? undefined : 2) ?? '';

interface InlineInputProps {
  initial: string;
  label: string;
  /** 回傳錯誤訊息時不送出（Enter 留在編輯中；失焦則放棄）。 */
  validate?: (text: string) => string | undefined;
  onCommit: (text: string) => void;
  onCancel: () => void;
  attributes: {
    className: string | undefined;
    style: CSSProperties | undefined;
    testId: string | undefined;
  };
}

function InlineInput({
  initial,
  label,
  validate,
  onCommit,
  onCancel,
  attributes,
}: InlineInputProps) {
  const [text, setText] = useState(initial);
  const error = validate?.(text);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!error) onCommit(text);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <input
      // 進入編輯時就是要打字，自動聚焦是預期行為
      // oxlint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      value={text}
      size={Math.max(text.length, 1)}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      title={error}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => (error ? onCancel() : onCommit(text))}
      className={cn(styles.input, attributes.className)}
      style={attributes.style}
      data-testid={attributes.testId}
    />
  );
}

interface ToolbarButtonProps {
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
}

function ToolbarButton({ label, icon, onClick, disabled }: ToolbarButtonProps) {
  return (
    <Tooltip content={label}>
      <IconButton size="sm" aria-label={label} onClick={onClick} disabled={disabled}>
        <Icon name={icon} size={16} />
      </IconButton>
    </Tooltip>
  );
}

/**
 * JSON 編輯器：樹狀模式（點鍵名／值直接編輯、每行的操作選單）與文字模式（原始 JSON），
 * 撤銷／重做（⌘/Ctrl + Z、⌘/Ctrl + Shift + Z）。外觀與操作對標 svelte-jsoneditor，
 * 樹狀渲染、收合、虛擬捲動與 `JsonViewer` 共用（docs/architecture/frontend/07-ui-system.md §3.12）。
 */
export function JsonEditor({
  ref,
  value: valueProp,
  defaultValue = EMPTY_OBJECT,
  onChange,
  mode: modeProp,
  defaultMode = 'tree',
  onModeChange,
  readOnly,
  maxHeight = DEFAULT_JSON_MAX_HEIGHT,
  defaultExpandDepth = Infinity,
  virtualThreshold,
  validator,
  onValidationChange,
  labels: labelOverrides,
  className,
  style,
  classNames,
  styles: styleOverrides,
  testIds,
  'aria-label': ariaLabel,
  ...rest
}: JsonEditorProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const errorId = useId();

  const [value, setValue] = useControllableState<unknown>(valueProp, defaultValue, onChange);
  const [mode, setMode] = useControllableState(modeProp, defaultMode, onModeChange);
  const history = useJsonHistory(value, setValue);
  const tree = useJsonTree(value, { defaultExpandDepth });
  const [editing, setEditing] = useState<EditingTarget>();
  const [draft, setDraft] = useState<TextDraft>({ text: '', source: undefined, error: undefined });
  const text =
    draft.source === value ? draft : { text: stringify(value), source: value, error: undefined };

  const errors = useJsonValidation(value, validator);
  const annotations = useMemo(() => toAnnotations(errors), [errors]);
  const onValidationChangeRef = useLatestRef(onValidationChange);
  useEffect(() => {
    onValidationChangeRef.current?.(errors);
  }, [errors, onValidationChangeRef]);

  // 搜尋與「跳到驗證錯誤」共用同一個焦點行
  const [search, setSearch] = useState(CLOSED_SEARCH);
  const [activeTarget, setActiveTarget] = useState<{ path: string }>();
  const searchInput = useRef<HTMLInputElement>(null);
  const matches = useMemo(
    () => (search.isOpen ? searchJson(value, search.query) : []),
    [value, search.isOpen, search.query],
  );
  const matchIndex = matches.length === 0 ? -1 : Math.min(search.index, matches.length - 1);
  const highlight = search.isOpen ? search.query : undefined;

  const goTo = useCallback(
    (path: string) => {
      tree.expandTo(path);
      setActiveTarget({ path });
    },
    [tree],
  );

  const openSearch = () => {
    setSearch((current) => (current.isOpen ? current : { ...current, isOpen: true }));
    searchInput.current?.focus();
    searchInput.current?.select();
  };

  const changeQuery = (query: string) => {
    setSearch({ isOpen: true, query, index: 0 });
    const first = searchJson(value, query)[0];
    if (first) goTo(first.path);
    else setActiveTarget(undefined);
  };

  const step = (delta: 1 | -1) => {
    if (matches.length === 0) return;
    const index = (matchIndex + delta + matches.length) % matches.length;
    setSearch((current) => ({ ...current, index }));
    goTo((matches[index] as { path: string }).path);
  };

  const closeSearch = () => {
    setSearch(CLOSED_SEARCH);
    setActiveTarget(undefined);
  };

  const selectError = (error: JsonValidationError) => {
    setMode('tree');
    goTo(formatPath(error.path));
  };

  const commit = useCallback(
    (next: unknown) => {
      setEditing(undefined);
      history.commit(next);
    },
    [history],
  );

  /** 插入節點後展開它的上層，並直接進入編輯（物件改鍵名、陣列改值）。 */
  const commitInsert = useCallback(
    ({ root, path }: InsertResult) => {
      history.commit(root);
      tree.expand(formatPath(path.slice(0, -1)));
      setEditing({
        path: formatPath(path),
        target: typeof path.at(-1) === 'string' ? 'key' : 'value',
        thenValue: true,
      });
    },
    [history, tree],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    // 樹狀模式攔下 ⌘/Ctrl + F（瀏覽器的尋找看不到虛擬捲動外的行）；文字模式交給瀏覽器
    if (key === 'f' && mode === 'tree') {
      event.preventDefault();
      openSearch();
      return;
    }
    if (readOnly) return;
    // 輸入框與文字框用瀏覽器自己的復原
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      history.undo();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      history.redo();
    }
  };

  const inputAttributes = (() => {
    const attributes = slot('input', undefined, { testId: 'json-editor-input' });
    return {
      className: attributes.className,
      style: attributes.style,
      testId: attributes['data-testid'],
    };
  })();

  const renderKey = (line: JsonLine): ReactNode => {
    const key = line.key as string;
    if (readOnly) return undefined;
    if (editing?.path === line.path && editing.target === 'key') {
      const path = parsePath(line.path);
      const parent = getIn(value, path.slice(0, -1));
      return (
        <InlineInput
          initial={key}
          label={labels.editKey}
          validate={(next) =>
            next !== key && hasKey(parent, next) ? labels.duplicateKey : undefined
          }
          onCommit={(next) => {
            const root = renameKey(value, path, next);
            if (editing.thenValue && line.type === 'value') {
              history.commit(root);
              setEditing({ path: formatPath([...path.slice(0, -1), next]), target: 'value' });
            } else {
              commit(root);
            }
          }}
          onCancel={() => setEditing(undefined)}
          attributes={inputAttributes}
        />
      );
    }
    return (
      <button
        type="button"
        className={cn(styles.editable, styles.key)}
        aria-label={`${labels.editKey}：${key}`}
        onClick={() => setEditing({ path: line.path, target: 'key' })}
      >
        {highlightText(key, highlight)}
      </button>
    );
  };

  const renderValue = (line: JsonLine & { type: 'value' }): ReactNode => {
    if (readOnly) return undefined;
    const path = parsePath(line.path);
    if (editing?.path === line.path && editing.target === 'value') {
      const current = getIn(value, path);
      return (
        <InlineInput
          initial={toEditText(current)}
          label={labels.editValue}
          onCommit={(next) => {
            const parsed = fromEditText(next);
            // 沒改就不留下一步歷史
            if (Object.is(parsed, current)) setEditing(undefined);
            else commit(setIn(value, path, parsed));
          }}
          onCancel={() => setEditing(undefined)}
          attributes={inputAttributes}
        />
      );
    }
    return (
      <button
        type="button"
        className={cn(styles.editable, JSON_PRIMITIVE_CLASS[line.kind])}
        aria-label={`${labels.editValue}：${line.text}`}
        onClick={() => setEditing({ path: line.path, target: 'value' })}
      >
        {highlightText(line.text, highlight)}
      </button>
    );
  };

  const renderActions = (line: JsonLine): ReactNode => {
    if (readOnly) return undefined;
    const path: JsonPath = parsePath(line.path);
    const isRoot = path.length === 0;
    const node = getIn(value, path);
    const nodeType: JsonConvertTarget =
      line.type === 'value' ? 'value' : Array.isArray(node) ? 'array' : 'object';
    const convertTo = (target: JsonConvertTarget) =>
      commit(setIn(value, path, convert(node, target)));

    const items: MenuItemDescriptor[] = [];
    if (line.key !== undefined) {
      items.push({
        key: 'editKey',
        label: labels.editKey,
        onSelect: () => setEditing({ path: line.path, target: 'key' }),
      });
    }
    if (line.type === 'value') {
      items.push({
        key: 'editValue',
        label: labels.editValue,
        onSelect: () => setEditing({ path: line.path, target: 'value' }),
      });
    } else {
      items.push({
        key: 'addChild',
        label: labels.addChild,
        onSelect: () => commitInsert(appendChild(value, path, NEW_VALUE, NEW_KEY)),
      });
    }
    if (!isRoot) {
      items.push(
        {
          key: 'insertAfter',
          label: labels.insertAfter,
          onSelect: () => commitInsert(insertAfter(value, path, NEW_VALUE, NEW_KEY)),
        },
        {
          key: 'duplicate',
          label: labels.duplicate,
          onSelect: () => commitInsert(duplicate(value, path)),
        },
      );
    }
    if (nodeType !== 'object') {
      items.push({
        key: 'convertToObject',
        label: labels.convertToObject,
        onSelect: () => convertTo('object'),
      });
    }
    if (nodeType !== 'array') {
      items.push({
        key: 'convertToArray',
        label: labels.convertToArray,
        onSelect: () => convertTo('array'),
      });
    }
    if (nodeType !== 'value') {
      items.push({
        key: 'convertToValue',
        label: labels.convertToValue,
        onSelect: () => convertTo('value'),
      });
    }
    if (!isRoot) {
      items.push({
        key: 'remove',
        label: labels.remove,
        tone: 'danger',
        onSelect: () => commit(removeIn(value, path)),
      });
    }

    return (
      <Menu
        align="end"
        items={items}
        trigger={
          <button
            type="button"
            className={styles.actionButton}
            aria-label={labels.actions}
            data-testid="json-editor-actions"
          >
            <Icon name="more" size={14} />
          </button>
        }
      />
    );
  };

  const handleTextChange = (next: string) => {
    try {
      const parsed: unknown = JSON.parse(next);
      history.commit(parsed, { coalesce: 'text' });
      setDraft({ text: next, source: parsed, error: undefined });
    } catch (error) {
      setDraft({
        text: next,
        source: value,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    // 快捷鍵掛在外層，接住從樹狀區各個按鈕冒泡上來的按鍵；外層本身不需要聚焦
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={ref}
      className={cn(styles.root, className)}
      style={style}
      data-mode={mode}
      data-readonly={readOnly || undefined}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      <div {...slot('toolbar', styles.toolbar, { testId: 'json-editor-toolbar' })}>
        <div className={styles.modes}>
          {MODES.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={mode === item ? 'secondary' : 'ghost'}
              aria-pressed={mode === item}
              // 文字模式的內容不合法時不能切回樹狀（樹狀需要解析後的值）
              disabled={item === 'tree' && Boolean(text.error)}
              onClick={() => setMode(item)}
              data-testid="json-editor-mode"
              data-value={item}
            >
              {item === 'tree' ? labels.tree : labels.text}
            </Button>
          ))}
        </div>
        {mode === 'tree' ? (
          <>
            <ToolbarButton label={labels.search} icon="search" onClick={openSearch} />
            <ToolbarButton
              label={labels.expandAll}
              icon="chevrons-up-down"
              onClick={tree.expandAll}
            />
            <ToolbarButton
              label={labels.collapseAll}
              icon="chevrons-down-up"
              onClick={tree.collapseAll}
            />
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(text.error)}
              onClick={() => setDraft({ text: stringify(value), source: value, error: undefined })}
            >
              {labels.format}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(text.error)}
              onClick={() =>
                setDraft({ text: stringify(value, true), source: value, error: undefined })
              }
            >
              {labels.compact}
            </Button>
          </>
        )}
        {!readOnly && (
          <span className={styles.history}>
            <ToolbarButton
              label={labels.undo}
              icon="undo"
              onClick={history.undo}
              disabled={!history.canUndo}
            />
            <ToolbarButton
              label={labels.redo}
              icon="redo"
              onClick={history.redo}
              disabled={!history.canRedo}
            />
          </span>
        )}
      </div>

      {mode === 'tree' && search.isOpen && (
        <JsonSearchBar
          inputRef={searchInput}
          query={search.query}
          activeIndex={matchIndex}
          total={matches.length}
          onQueryChange={changeQuery}
          onNext={() => step(1)}
          onPrevious={() => step(-1)}
          onClose={closeSearch}
          labels={labels}
          slotAttributes={slot('search', styles.search, { testId: 'json-editor-search' })}
        />
      )}

      {mode === 'tree' ? (
        <JsonTree
          lines={tree.lines}
          onToggle={tree.toggle}
          maxHeight={maxHeight}
          virtualThreshold={virtualThreshold}
          labels={labels}
          slot={slot}
          className={styles.body}
          aria-label={ariaLabel}
          activeTarget={activeTarget}
          highlight={highlight}
          annotations={annotations}
          renderKey={renderKey}
          renderValue={renderValue}
          renderActions={renderActions}
        />
      ) : (
        <>
          <textarea
            {...slot('textarea', styles.textarea, {
              style: { height: maxHeight },
              testId: 'json-editor-text',
            })}
            value={text.text}
            readOnly={readOnly}
            spellCheck={false}
            aria-label={ariaLabel}
            aria-invalid={text.error ? true : undefined}
            aria-describedby={text.error ? errorId : undefined}
            onChange={(event) => handleTextChange(event.target.value)}
          />
          {text.error && (
            <p
              id={errorId}
              role="alert"
              {...slot('error', styles.error, { testId: 'json-editor-error' })}
            >
              {labels.parseError}：{text.error}
            </p>
          )}
        </>
      )}

      {errors.length > 0 && (
        <ValidationPanel
          errors={errors}
          onSelect={selectError}
          disabled={Boolean(text.error)}
          labels={labels}
          slotAttributes={slot('validation', styles.validation, {
            testId: 'json-editor-validation',
          })}
        />
      )}
    </div>
  );
}
