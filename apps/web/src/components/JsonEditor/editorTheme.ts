import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

import theme from '../JsonViewer/jsonTheme.module.css';

/**
 * 語法上色：直接套 `JsonViewer` 用的 class（jsonTheme.module.css），兩邊顏色只有一份定義。
 * `@lezer/json` 的標記：鍵名 propertyName、`, :` separator、括號 brace / squareBracket。
 */
const jsonHighlightStyle = HighlightStyle.define(
  [
    { tag: tags.propertyName, class: theme.key },
    { tag: tags.string, class: theme.string },
    { tag: tags.number, class: theme.number },
    { tag: tags.bool, class: theme.boolean },
    { tag: tags.null, class: theme.null },
    { tag: [tags.separator, tags.brace, tags.squareBracket], class: theme.punctuation },
  ].filter((spec) => spec.class !== undefined),
);

/**
 * 版面：以 jsonTheme.module.css 的 --json-* 變數設定，與 `JsonViewer` 的行號欄、行高、留白逐項對應。
 * 用 `EditorView.theme` 而不是 CSS Module：CodeMirror 的預設樣式是不分層的 `<style>`，
 * 會蓋過 `@layer components` 裡的規則，只有同樣以 theme 注入才壓得過。
 * 值只引用變數（沒有色碼），深色主題跟著 alias token 切換。
 */
const jsonEditorTheme = EditorView.theme({
  '&': {
    maxHeight: 'var(--json-editor-max-height)',
    backgroundColor: 'var(--json-background)',
    color: 'var(--json-color)',
    fontSize: 'var(--json-font-size)',
  },
  // 焦點框畫在 JsonEditor 的外框上
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: 'var(--json-line-height)',
    overscrollBehavior: 'contain',
  },
  '.cm-content': {
    padding: 'var(--json-padding-block) 0',
    caretColor: 'var(--json-color)',
  },
  '.cm-line': { padding: '0 var(--seed-space-3) 0 var(--json-content-inset)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--json-color)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    { backgroundColor: 'var(--json-selection-background)' },
  '.cm-activeLine': { backgroundColor: 'var(--json-active-line-background)' },
  '.cm-gutters': {
    borderRight: '1px solid var(--json-gutter-border)',
    backgroundColor: 'var(--json-gutter-background)',
    color: 'var(--json-gutter-color)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--json-active-line-background)' },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '2ch',
    padding: '0 var(--seed-space-1) 0 var(--seed-space-2)',
  },
  '.cm-foldGutter .cm-gutterElement': {
    display: 'flex',
    width: 'var(--json-fold-width)',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--json-color)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--json-placeholder-background)',
    outline: '1px solid var(--json-gutter-border)',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--json-search-match-background)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--json-search-match-active-background)',
  },
  '.cm-panels': { backgroundColor: 'var(--color-bg)', color: 'var(--color-fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-border)' },
  // 預設的波浪底線是寫死顏色的 SVG；改成跟著 token 的底線
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--json-error-color)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-tooltip': {
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-fg)',
    boxShadow: 'var(--shadow-popover)',
  },
  '.cm-diagnostic': { fontFamily: 'var(--font-sans)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--json-error-color)' },
});

export const jsonEditorAppearance: Extension = [
  jsonEditorTheme,
  syntaxHighlighting(jsonHighlightStyle),
];
