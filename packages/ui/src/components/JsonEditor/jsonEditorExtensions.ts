import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from '@codemirror/language';
import { linter, lintKeymap } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { search, searchKeymap } from '@codemirror/search';
import { Annotation, EditorState, StateEffect, StateField } from '@codemirror/state';
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
import type { RefObject } from 'react';

import { jsonEditorAppearance } from './editorTheme';
import { describeFold, findPathRange } from './jsonDocument';
import type { ResolvedJsonEditorLabels } from './jsonEditorLabels';
import type { JsonValidationError } from './validation';

import theme from '../JsonViewer/jsonTheme.module.css';

/*
 * JsonEditor 的 CodeMirror 設定：解析與驗證結果的 StateField、linter、摺疊、搜尋面板（交給 React 渲染）、
 * 快捷鍵與外觀。元件（`JsonEditor.tsx`）只處理 props 與狀態同步，經由 `EditorBridge` 把最新的文案與 callback 交給這裡。
 */

export const stringify = (value: unknown, compact = false) =>
  JSON.stringify(value, null, compact ? undefined : 2) ?? '';

export interface ParseResult {
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
export const parsedDocument = StateField.define<ParseResult>({
  create: (state) => parseText(state.doc.toString()),
  update: (current, transaction) =>
    transaction.docChanged ? parseText(transaction.state.doc.toString()) : current,
});

/** 驗證結果（非同步回來）交給編輯器，linter 據此畫底線。 */
export const setValidationErrors = StateEffect.define<readonly JsonValidationError[]>();

const validationErrors = StateField.define<readonly JsonValidationError[]>({
  create: () => [],
  update: (current, transaction) =>
    transaction.effects.reduce(
      (errors, effect) => (effect.is(setValidationErrors) ? effect.value : errors),
      current,
    ),
});

/** 格式化／壓縮只改排版，值沒變，不回報 `onChange`。 */
export const layoutOnly = Annotation.define<boolean>();

/** 編輯器裡會隨 React 狀態改變的部分；CodeMirror 的 extension 經由 ref 取最新值。 */
export interface EditorBridge {
  labels: ResolvedJsonEditorLabels;
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
export function configOf(readOnly: boolean, ariaLabel: string | undefined): Extension {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? '' }),
  ];
}

export interface InitialConfig {
  config: Extension;
  /** 重建內容時沿用目前的驗證結果（值沒變就不會重新驗證）。 */
  errors: readonly JsonValidationError[];
}

export function createExtensions(
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
