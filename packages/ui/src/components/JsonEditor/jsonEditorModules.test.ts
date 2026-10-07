import { search, SearchQuery, setSearchQuery } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';

import { parsedDocument, stringify } from './jsonEditorExtensions';
import { DEFAULT_JSON_EDITOR_LABELS } from './jsonEditorLabels';
import { jsonEditorToolbarItems } from './jsonEditorToolbar';
import type { JsonEditorToolbarOptions } from './jsonEditorToolbar';
import { collectMatches, searchStatusOf } from './jsonSearch';

describe('parsedDocument（內容解析後的值）', () => {
  it('合法 JSON 回傳值；打到一半時回傳錯誤訊息，值是 undefined', () => {
    const valid = EditorState.create({ doc: '{"a": [1, 2]}', extensions: [parsedDocument] });
    expect(valid.field(parsedDocument)).toEqual({ value: { a: [1, 2] }, error: undefined });

    const invalid = valid.update({ changes: { from: 0, insert: 'x' } }).state;
    expect(invalid.field(parsedDocument).value).toBeUndefined();
    expect(invalid.field(parsedDocument).error).toEqual(expect.any(String));
  });

  it('stringify：預設兩格縮排，compact 時一行', () => {
    expect(stringify({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(stringify({ a: 1 }, true)).toBe('{"a":1}');
  });
});

/** 帶著搜尋字（與選取）的編輯器狀態。 */
const withQuery = (doc: string, text: string, selection?: { anchor: number; head: number }) =>
  EditorState.create({ doc, extensions: [search()], selection }).update({
    effects: setSearchQuery.of(new SearchQuery({ search: text })),
  }).state;

describe('jsonSearch（搜尋列的查詢）', () => {
  it('列出所有符合的位置；空白的關鍵字沒有結果', () => {
    expect(collectMatches(withQuery('{"ab": "abc"}', 'ab'))).toMatchObject([
      { from: 2, to: 4 },
      { from: 8, to: 10 },
    ]);
    expect(collectMatches(withQuery('{"ab": 1}', '   '))).toEqual([]);
  });

  it('目前選取的是第幾筆；沒有選在任何一筆上是 -1', () => {
    expect(searchStatusOf(withQuery('{"ab": "abc"}', 'ab', { anchor: 8, head: 10 }))).toEqual({
      index: 1,
      total: 2,
    });
    expect(searchStatusOf(withQuery('{"ab": "abc"}', 'ab'))).toEqual({ index: -1, total: 2 });
  });
});

const OPTIONS: JsonEditorToolbarOptions = {
  labels: DEFAULT_JSON_EDITOR_LABELS,
  readOnly: false,
  hasParseError: false,
  canUndo: true,
  canRedo: false,
  onSearch: vi.fn(),
  onExpandAll: vi.fn(),
  onCollapseAll: vi.fn(),
  onFormat: vi.fn(),
  onCompact: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
};

describe('jsonEditorToolbarItems（工具列）', () => {
  it('唯讀只有搜尋與摺疊', () => {
    const items = jsonEditorToolbarItems({ ...OPTIONS, readOnly: true });
    expect(items.map((item) => item.key)).toEqual(['search', 'expand-all', 'collapse-all']);
  });

  it('內容不合法時不能格式化、壓縮；復原／重做跟著歷史', () => {
    const items = jsonEditorToolbarItems({ ...OPTIONS, hasParseError: true });
    const disabled = Object.fromEntries(items.map((item) => [item.key, Boolean(item.disabled)]));
    expect(disabled).toMatchObject({ format: true, compact: true, undo: false, redo: true });
  });
});
