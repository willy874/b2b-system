import { cn } from '@b2b-system/web-shared/utils';
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { foldedRanges, unfoldAll, unfoldEffect } from '@codemirror/language';
import { forceLinting } from '@codemirror/lint';
import {
  closeSearchPanel,
  getSearchQuery,
  openSearchPanel,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import type { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import { createPortal } from 'react-dom';

import { DEFAULT_JSON_MAX_HEIGHT } from '../JsonViewer';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Toolbar } from '../Toolbar';
import { useControllableState } from '../useControllableState';
import { useLatestRef } from '../useLatestRef';
import { findPathRange, foldAtDepth } from './jsonDocument';
import {
  configOf,
  createExtensions,
  layoutOnly,
  parsedDocument,
  setValidationErrors,
  stringify,
} from './jsonEditorExtensions';
import type { EditorBridge } from './jsonEditorExtensions';
import { DEFAULT_JSON_EDITOR_LABELS } from './jsonEditorLabels';
import type { JsonEditorLabels, ResolvedJsonEditorLabels } from './jsonEditorLabels';
import { jsonEditorToolbarItems } from './jsonEditorToolbar';
import { collectMatches, NO_MATCHES, revealRange, searchStatusOf } from './jsonSearch';
import { JsonSearchBar } from './JsonSearchBar';
import { useJsonValidation } from './useJsonValidation';
import type { JsonValidationError, JsonValidator } from './validation';
import { ValidationPanel } from './ValidationPanel';

import theme from '../JsonViewer/jsonTheme.module.css';
import styles from './JsonEditor.module.css';

export type { JsonEditorLabels } from './jsonEditorLabels';

/** `className` / `data-testid` 落在最外層；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type JsonEditorSlot = 'toolbar' | 'search' | 'content' | 'error' | 'validation';

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
/** `defaultValue` 的預設；固定參考，不會每次 render 都是新物件。 */
const EMPTY_OBJECT = {};

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
 * CodeMirror 的設定在 `jsonEditorExtensions.ts`、搜尋在 `jsonSearch.ts`；這裡只處理 props 與狀態同步。
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
  const labels: ResolvedJsonEditorLabels = { ...DEFAULT_JSON_EDITOR_LABELS, ...labelOverrides };
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
  }, [host, createDocumentRef, documentValue]);

  // 外部換了值（不是剛才自己回報的那一個）：整份內容重新產生
  useEffect(() => {
    if (!view || Object.is(value, documentValue.current)) return;
    documentValue.current = value;
    const { state, fold } = createDocumentRef.current(value);
    view.setState(state);
    if (fold.length > 0) view.dispatch({ effects: fold });
    setStatus(INITIAL_STATUS);
  }, [value, view, createDocumentRef, documentValue]);

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

  const toolbarItems = jsonEditorToolbarItems({
    labels,
    readOnly,
    hasParseError: Boolean(status.parseError),
    canUndo: status.canUndo,
    canRedo: status.canRedo,
    onSearch: run(openSearchPanel),
    onExpandAll: run(unfoldAll),
    onCollapseAll: collapseAll,
    onFormat: () => relayout(false),
    onCompact: () => relayout(true),
    onUndo: run(undo),
    onRedo: run(redo),
  });

  return (
    <div
      ref={ref}
      className={cn(styles.root, className)}
      style={{ '--json-editor-max-height': toCssLength(maxHeight), ...style } as CSSProperties}
      data-readonly={readOnly || undefined}
      {...rest}
    >
      <div {...slot('toolbar', styles.toolbar, { testId: 'json-editor-toolbar' })}>
        <Toolbar items={toolbarItems} moreLabel={labels.more} />
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
