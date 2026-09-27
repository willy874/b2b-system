import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import {
  bracketMatching,
  codeFolding,
  foldedRanges,
  foldGutter,
  foldKeymap,
  indentOnInput,
  unfoldAll,
  unfoldEffect,
} from '@codemirror/language';
import { forceLinting, linter, lintKeymap } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import {
  closeSearchPanel,
  getSearchQuery,
  openSearchPanel,
  search,
  searchKeymap,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import { Annotation, Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, Ref, RefObject } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/shared/utils';

import { Button, IconButton } from '../Button';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { DEFAULT_JSON_MAX_HEIGHT } from '../JsonViewer';
import type { JsonViewerLabels } from '../JsonViewer';
import type { JsonContainerKind } from '../JsonViewer/jsonLines';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Tooltip } from '../Tooltip';
import { useControllableState } from '../useControllableState';
import { useLatestRef } from '../useLatestRef';
import { jsonEditorAppearance } from './editorTheme';
import { describeFold, findPathRange, foldAtDepth } from './jsonDocument';
import { JsonSearchBar } from './JsonSearchBar';
import { useJsonValidation } from './useJsonValidation';
import type { JsonValidationError, JsonValidator } from './validation';
import { ValidationPanel } from './ValidationPanel';

import theme from '../JsonViewer/jsonTheme.module.css';
import styles from './JsonEditor.module.css';

/** `className` / `data-testid` 落在最外層；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type JsonEditorSlot = 'toolbar' | 'search' | 'content' | 'error' | 'validation';

export interface JsonEditorLabels extends JsonViewerLabels {
  expandAll?: string;
  collapseAll?: string;
  format?: string;
  compact?: string;
  undo?: string;
  redo?: string;
  /** 內容不是合法 JSON；後面接瀏覽器的錯誤訊息。 */
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
  /**
   * 受控的值。內容是合法 JSON 時以 `onChange` 回報解析後的新值；打到一半（不合法）時不回報。
   * 傳入的值與最後一次回報的不是同一個參考時，整份內容重新產生（復原紀錄、游標、摺疊會重設）。
   */
  value?: unknown;
  defaultValue?: unknown;
  onChange?: (value: unknown) => void;
  /** 只能看、搜尋與摺疊，不能改。 */
  readOnly?: boolean;
  /** 編輯區的最大高度（預設 `20rem`），超過在框內捲動。 */
  maxHeight?: CSSProperties['maxHeight'];
  /** 這個深度（含）以下的物件／陣列一開始是摺疊的；根節點深度為 0。預設全部展開。 */
  defaultExpandDepth?: number;
  /**
   * 驗證：錯誤的位置畫上波浪底線（滑過顯示訊息），編輯區下方列出錯誤（點一下跳過去）。
   * JSON Schema 用 `createJsonSchemaValidator(schema)`；請保持參考固定（模組層級或 `useMemo`），改變時會重新驗證。
   */
  validator?: JsonValidator;
  /** 驗證結果改變時通知（例如在錯誤未清空前停用送出鈕）。 */
  onValidationChange?: (errors: readonly JsonValidationError[]) => void;
  /** 預設文案是繁中；`features/` 使用時以 `t()` 傳入。 */
  labels?: JsonEditorLabels;
  className?: string;
  style?: CSSProperties;
  /** 編輯區的名稱。 */
  'aria-label'?: string;
  'data-testid'?: string;
}

const DEFAULT_LABELS = {
  expand: '展開',
  collapse: '收合',
  summary: (size: number, container: JsonContainerKind) =>
    container === 'array' ? `${size} 項` : `${size} 個欄位`,
  expandAll: '全部展開',
  collapseAll: '全部收合',
  format: '格式化',
  compact: '壓縮',
  undo: '復原',
  redo: '重做',
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
} satisfies Required<JsonEditorLabels>;

type ResolvedLabels = typeof DEFAULT_LABELS;

/** `defaultValue` 的預設；固定參考，不會每次 render 都是新物件。 */
const EMPTY_OBJECT = {};

const stringify = (value: unknown, compact = false) =>
  JSON.stringify(value, null, compact ? undefined : 2) ?? '';

interface ParseResult {
  value: unknown;
  error: string | undefined;
}

function parseText(text: string): ParseResult {
  try {
    return { value: JSON.parse(text) as unknown, error: undefined };
  } catch (error) {
    return { value: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 文件解析後的值；每次內容改變解析一次，回報 `onChange`、錯誤訊息、`aria-invalid` 共用。 */
const parsedDocument = StateField.define<ParseResult>({
  create: (state) => parseText(state.doc.toString()),
  update: (current, transaction) =>
    transaction.docChanged ? parseText(transaction.state.doc.toString()) : current,
});

/** 驗證結果（非同步回來）交給編輯器，linter 據此畫底線。 */
const setValidationErrors = StateEffect.define<readonly JsonValidationError[]>();

const validationErrors = StateField.define<readonly JsonValidationError[]>({
  create: () => [],
  update: (current, transaction) =>
    transaction.effects.reduce(
      (errors, effect) => (effect.is(setValidationErrors) ? effect.value : errors),
      current,
    ),
});

/** 格式化／壓縮只改排版，值沒變，不回報 `onChange`。 */
const layoutOnly = Annotation.define<boolean>();

interface SearchStatus {
  /** 目前選取的是第幾筆（0 起算）；沒有選在任何一筆上時為 -1。 */
  index: number;
  total: number;
}

const NO_MATCHES: SearchStatus = { index: -1, total: 0 };

interface Range {
  from: number;
  to: number;
}

function collectMatches(state: EditorState): Range[] {
  const text = getSearchQuery(state).search.trim();
  if (text === '') return [];
  const query = new SearchQuery({ search: text });
  if (!query.valid) return [];
  const matches: Range[] = [];
  const cursor = query.getCursor(state);
  for (let result = cursor.next(); !result.done; result = cursor.next()) {
    matches.push(result.value);
  }
  return matches;
}

function searchStatusOf(state: EditorState): SearchStatus {
  const matches = collectMatches(state);
  const { from, to } = state.selection.main;
  return {
    index: matches.findIndex((match) => match.from === from && match.to === to),
    total: matches.length,
  };
}

/** 選取某段文字：打開包住它的摺疊，捲到畫面中間。 */
function revealRange(view: EditorView, range: Range) {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(range.from, range.to, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  effects.push(EditorView.scrollIntoView(range.from, { y: 'center' }));
  view.dispatch({ selection: { anchor: range.from, head: range.to }, effects });
}

/** 編輯器裡會隨 React 狀態改變的部分；CodeMirror 的 extension 經由 ref 取最新值。 */
interface EditorBridge {
  labels: ResolvedLabels;
  errorId: string;
  onUpdate: (update: ViewUpdate) => void;
  onSearchPanel: (panel: HTMLElement | null) => void;
}

function validationDiagnostics(state: EditorState): Diagnostic[] {
  // 內容不合法時，驗證結果屬於上一版的值，位置對不上
  if (state.field(parsedDocument).error) return [];
  return state.field(validationErrors).flatMap((error) => {
    const range = findPathRange(state, error.path);
    return range ? [{ ...range, severity: 'error' as const, message: error.message }] : [];
  });
}

/** 會隨 props 改變的設定，放在 Compartment 裡重設。 */
function configOf(readOnly: boolean, ariaLabel: string | undefined): Extension {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? '' }),
  ];
}

interface InitialConfig {
  config: Extension;
  /** 重建內容時沿用目前的驗證結果（值沒變就不會重新驗證）。 */
  errors: readonly JsonValidationError[];
}

function createExtensions(
  bridge: RefObject<EditorBridge>,
  { config, errors }: InitialConfig,
): Extension {
  return [
    lineNumbers(),
    foldGutter({
      // 與 JsonViewer 的摺疊箭頭同一個樣式
      markerDOM: (open) => {
        const marker = document.createElement('span');
        marker.className = theme.foldMarker ?? '';
        if (open) marker.dataset.open = '';
        marker.title = open ? bridge.current.labels.collapse : bridge.current.labels.expand;
        return marker;
      },
    }),
    codeFolding({
      preparePlaceholder: (state, range) => {
        const fold = describeFold(state, range);
        return fold ? bridge.current.labels.summary(fold.size, fold.container) : undefined;
      },
      placeholderDOM: (_view, onclick, summary: string | undefined) => {
        const placeholder = document.createElement('span');
        placeholder.className = theme.foldPlaceholder ?? '';
        placeholder.textContent = '…';
        if (summary) placeholder.title = summary;
        placeholder.addEventListener('click', onclick);
        return placeholder;
      },
    }),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    json(),
    EditorState.tabSize.of(2),
    parsedDocument,
    validationErrors.init(() => errors),
    linter((view) => [...jsonParseLinter()(view), ...validationDiagnostics(view.state)], {
      delay: 300,
      // 驗證結果回來時也要重畫，不等下一次編輯
      needsRefresh: (update) =>
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setValidationErrors)),
        ),
    }),
    search({
      top: true,
      // 搜尋列用設計系統的元件（JsonSearchBar），以 portal 渲染進 CodeMirror 的面板位置
      createPanel: () => {
        const dom = document.createElement('div');
        return {
          dom,
          top: true,
          mount: () => bridge.current.onSearchPanel(dom),
          destroy: () => bridge.current.onSearchPanel(null),
        };
      },
    }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...lintKeymap,
    ]),
    EditorView.contentAttributes.of((view) =>
      view.state.field(parsedDocument).error
        ? { 'aria-invalid': 'true', 'aria-describedby': bridge.current.errorId }
        : null,
    ),
    EditorView.updateListener.of((update) => bridge.current.onUpdate(update)),
    jsonEditorAppearance,
    config,
  ];
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

interface EditorStatus {
  canUndo: boolean;
  canRedo: boolean;
  parseError: string | undefined;
}

const INITIAL_STATUS: EditorStatus = { canUndo: false, canRedo: false, parseError: undefined };

const isSameStatus = (a: EditorStatus, b: EditorStatus) =>
  a.canUndo === b.canUndo && a.canRedo === b.canRedo && a.parseError === b.parseError;

/**
 * JSON 編輯器，底層是 CodeMirror 6：語法上色、行號、摺疊、括號配對、復原／重做（⌘/Ctrl + Z、⌘/Ctrl + Shift + Z）、
 * 搜尋（⌘/Ctrl + F）、格式化／壓縮，以及 JSON Schema 驗證（波浪底線 ＋ 下方錯誤清單）。
 * 外觀與 `JsonViewer` 一致（docs/architecture/frontend/07-ui-system.md §3.12）。
 */
export function JsonEditor({
  ref,
  value: valueProp,
  defaultValue = EMPTY_OBJECT,
  onChange,
  readOnly = false,
  maxHeight = DEFAULT_JSON_MAX_HEIGHT,
  defaultExpandDepth = Infinity,
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
  const labels: ResolvedLabels = { ...DEFAULT_LABELS, ...labelOverrides };
  const errorId = useId();

  const [value, setValue] = useControllableState<unknown>(valueProp, defaultValue, onChange);
  /** 編輯器目前內容對應的值：自己回報出去的值回到 props 時不重建內容。 */
  const documentValue = useRef(value);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<EditorView>();
  const [status, setStatus] = useState(INITIAL_STATUS);
  const [searchPanel, setSearchPanel] = useState<HTMLElement | null>(null);
  const [searchText, setSearchText] = useState('');
  const [searchStatus, setSearchStatus] = useState(NO_MATCHES);

  const errors = useJsonValidation(value, validator);
  const onValidationChangeRef = useLatestRef(onValidationChange);
  useEffect(() => {
    onValidationChangeRef.current?.(errors);
  }, [errors, onValidationChangeRef]);

  const bridge = useLatestRef<EditorBridge>({
    labels,
    errorId,
    onUpdate: (update) => {
      const parsed = update.state.field(parsedDocument);
      const isLayoutOnly = update.transactions.some((transaction) =>
        transaction.annotation(layoutOnly),
      );
      if (update.docChanged && !parsed.error && !isLayoutOnly) {
        documentValue.current = parsed.value;
        setValue(parsed.value);
      }
      const next: EditorStatus = {
        canUndo: undoDepth(update.state) > 0,
        canRedo: redoDepth(update.state) > 0,
        parseError: parsed.error,
      };
      setStatus((current) => (isSameStatus(current, next) ? current : next));
      if (searchPanel) setSearchStatus(searchStatusOf(update.state));
    },
    onSearchPanel: (panel) => {
      setSearchPanel(panel);
      if (panel && view) {
        setSearchText(getSearchQuery(view.state).search);
        setSearchStatus(searchStatusOf(view.state));
      }
    },
  });

  // readOnly、名稱改變時只重設這一格，不重建編輯器
  const [configCompartment] = useState(() => new Compartment());

  /** 以某個值建立全新的內容：沒有復原紀錄，摺疊回到 `defaultExpandDepth`。 */
  const createDocument = (next: unknown) => {
    const state = EditorState.create({
      doc: stringify(next),
      extensions: createExtensions(bridge, {
        config: configCompartment.of(configOf(readOnly, ariaLabel)),
        errors,
      }),
    });
    return { state, fold: foldAtDepth(state, defaultExpandDepth) };
  };
  const createDocumentRef = useLatestRef(createDocument);

  useEffect(() => {
    if (!host) return;
    const { state, fold } = createDocumentRef.current(documentValue.current);
    const created = new EditorView({ state, parent: host });
    if (fold.length > 0) created.dispatch({ effects: fold });
    setView(created);
    return () => {
      created.destroy();
      setView(undefined);
    };
  }, [host, createDocumentRef]);

  // 外部換了值（不是剛才自己回報的那一個）：整份內容重新產生
  useEffect(() => {
    if (!view || Object.is(value, documentValue.current)) return;
    documentValue.current = value;
    const { state, fold } = createDocumentRef.current(value);
    view.setState(state);
    if (fold.length > 0) view.dispatch({ effects: fold });
    setStatus(INITIAL_STATUS);
  }, [value, view, createDocumentRef]);

  useEffect(() => {
    view?.dispatch({ effects: configCompartment.reconfigure(configOf(readOnly, ariaLabel)) });
  }, [view, readOnly, ariaLabel, configCompartment]);

  // 驗證結果是非同步回來的：交給編輯器後立刻重新 lint
  useEffect(() => {
    if (!view) return;
    view.dispatch({ effects: setValidationErrors.of(errors) });
    forceLinting(view);
  }, [view, errors]);

  const changeQuery = (text: string) => {
    setSearchText(text);
    if (!view) return;
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: text.trim() })) });
    const first = collectMatches(view.state)[0];
    if (first) revealRange(view, first);
    setSearchStatus(searchStatusOf(view.state));
  };

  const step = (delta: 1 | -1) => {
    if (!view) return;
    const matches = collectMatches(view.state);
    if (matches.length === 0) return;
    const { from } = view.state.selection.main;
    const next =
      delta === 1
        ? (matches.find((match) => match.from > from) ?? matches[0])
        : (matches.findLast((match) => match.from < from) ?? matches.at(-1));
    if (next) revealRange(view, next);
  };

  const closeSearch = () => {
    if (!view) return;
    closeSearchPanel(view);
    view.focus();
  };

  const collapseAll = () => {
    if (!view) return;
    const effects: StateEffect<unknown>[] = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      effects.push(unfoldEffect.of({ from, to }));
    });
    // 與 JsonViewer 的預設一樣，根節點保持展開
    view.dispatch({ effects: [...effects, ...foldAtDepth(view.state, 1)] });
  };

  const relayout = (compact: boolean) => {
    if (!view) return;
    const parsed = view.state.field(parsedDocument);
    if (parsed.error) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: stringify(parsed.value, compact) },
      annotations: layoutOnly.of(true),
    });
  };

  const selectError = (error: JsonValidationError) => {
    if (!view) return;
    const range = findPathRange(view.state, error.path);
    if (!range) return;
    revealRange(view, range);
    view.focus();
  };

  const run = (command: (target: EditorView) => boolean) => () => {
    if (view) command(view);
  };

  return (
    <div
      ref={ref}
      className={cn(styles.root, className)}
      style={{ '--json-editor-max-height': toCssLength(maxHeight), ...style } as CSSProperties}
      data-readonly={readOnly || undefined}
      {...rest}
    >
      <div {...slot('toolbar', styles.toolbar, { testId: 'json-editor-toolbar' })}>
        <ToolbarButton label={labels.search} icon="search" onClick={run(openSearchPanel)} />
        <ToolbarButton label={labels.expandAll} icon="chevrons-up-down" onClick={run(unfoldAll)} />
        <ToolbarButton label={labels.collapseAll} icon="chevrons-down-up" onClick={collapseAll} />
        {!readOnly && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(status.parseError)}
              onClick={() => relayout(false)}
            >
              {labels.format}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(status.parseError)}
              onClick={() => relayout(true)}
            >
              {labels.compact}
            </Button>
            <span className={styles.history}>
              <ToolbarButton
                label={labels.undo}
                icon="undo"
                onClick={run(undo)}
                disabled={!status.canUndo}
              />
              <ToolbarButton
                label={labels.redo}
                icon="redo"
                onClick={run(redo)}
                disabled={!status.canRedo}
              />
            </span>
          </>
        )}
      </div>

      <div
        ref={setHost}
        {...slot('content', cn(theme.theme, styles.content), { testId: 'json-editor-content' })}
      />

      {searchPanel &&
        createPortal(
          <JsonSearchBar
            query={searchText}
            activeIndex={searchStatus.index}
            total={searchStatus.total}
            onQueryChange={changeQuery}
            onNext={() => step(1)}
            onPrevious={() => step(-1)}
            onClose={closeSearch}
            labels={labels}
            slotAttributes={slot('search', styles.search, { testId: 'json-editor-search' })}
          />,
          searchPanel,
        )}

      {status.parseError && (
        <p
          id={errorId}
          role="alert"
          {...slot('error', styles.error, { testId: 'json-editor-error' })}
        >
          {labels.parseError}：{status.parseError}
        </p>
      )}

      {errors.length > 0 && (
        <ValidationPanel
          errors={errors}
          onSelect={selectError}
          disabled={Boolean(status.parseError)}
          labels={labels}
          slotAttributes={slot('validation', styles.validation, {
            testId: 'json-editor-validation',
          })}
        />
      )}
    </div>
  );
}

/** `maxHeight` 是數字時與 React 的 style 一樣視為 px。 */
function toCssLength(length: CSSProperties['maxHeight']): string | undefined {
  return typeof length === 'number' ? `${length}px` : length;
}
