import { foldedRanges, unfoldEffect } from '@codemirror/language';
import { getSearchQuery, SearchQuery } from '@codemirror/search';
import type { EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/* 搜尋列（`JsonSearchBar`）用的查詢：所有符合的位置、目前是第幾筆、選取並捲到某一筆。 */

export interface SearchStatus {
  /** 目前選取的是第幾筆（0 起算）；沒有選在任何一筆上時為 -1。 */
  index: number;
  total: number;
}

export const NO_MATCHES: SearchStatus = { index: -1, total: 0 };

export interface TextRange {
  from: number;
  to: number;
}

export function collectMatches(state: EditorState): TextRange[] {
  const text = getSearchQuery(state).search.trim();
  if (text === '') return [];
  const query = new SearchQuery({ search: text });
  if (!query.valid) return [];
  const matches: TextRange[] = [];
  const cursor = query.getCursor(state);
  for (let result = cursor.next(); !result.done; result = cursor.next()) {
    matches.push(result.value);
  }
  return matches;
}

export function searchStatusOf(state: EditorState): SearchStatus {
  const matches = collectMatches(state);
  const { from, to } = state.selection.main;
  return {
    index: matches.findIndex((match) => match.from === from && match.to === to),
    total: matches.length,
  };
}

/** 選取某段文字：打開包住它的摺疊，捲到畫面中間。 */
export function revealRange(view: EditorView, range: TextRange) {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(range.from, range.to, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  effects.push(EditorView.scrollIntoView(range.from, { y: 'center' }));
  view.dispatch({ selection: { anchor: range.from, head: range.to }, effects });
}
