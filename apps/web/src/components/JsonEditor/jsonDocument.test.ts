import { json } from '@codemirror/lang-json';
import type { foldEffect } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import type { JsonPath } from '../JsonViewer/jsonLines';
import { describeFold, findPathRange, foldAtDepth } from './jsonDocument';

const stateOf = (value: unknown) =>
  EditorState.create({ doc: JSON.stringify(value, null, 2), extensions: json() });

const textAt = (state: EditorState, path: JsonPath) => {
  const range = findPathRange(state, path);
  return range && state.doc.sliceString(range.from, range.to);
};

describe('findPathRange', () => {
  const state = stateOf({ name: 'a', stats: { hp: 1 }, list: [true, { x: null }] });

  it.each<[string, JsonPath, string | undefined]>([
    ['物件成員是基本型別：鍵名連值', ['name'], '"name": "a"'],
    ['物件成員是容器：只標鍵名', ['stats'], '"stats"'],
    ['巢狀成員', ['stats', 'hp'], '"hp": 1'],
    ['陣列元素是基本型別：標值', ['list', 0], 'true'],
    ['陣列元素是容器：只標開頭的括號', ['list', 1], '{'],
    ['根節點：只標開頭的括號', [], '{'],
    ['找不到的鍵', ['missing'], undefined],
    ['超出範圍的索引', ['list', 5], undefined],
  ])('%s', (_, path, expected) => {
    expect(textAt(state, path)).toBe(expected);
  });

  it('重複的鍵以最後一個為準（與 JSON.parse 相同）', () => {
    const duplicated = EditorState.create({ doc: '{"a": 1, "a": 2}', extensions: json() });
    expect(textAt(duplicated, ['a'])).toBe('"a": 2');
  });
});

describe('foldAtDepth', () => {
  const state = stateOf({ a: { b: { c: 1 } }, list: [1], empty: {} });
  const folded = (depth: number) =>
    foldAtDepth(state, depth).map((effect) => {
      const { from, to } = (effect as ReturnType<typeof foldEffect.of>).value;
      return state.doc.sliceString(from - 1, to + 1).replace(/\s+/g, '');
    });

  it('摺疊剛好在這個深度、跨多行的容器；空容器不摺', () => {
    expect(folded(1)).toEqual(['{"b":{"c":1}}', '[1]']);
    expect(folded(2)).toEqual(['{"c":1}']);
  });

  it('深度 0 摺疊根節點；Infinity 什麼都不摺', () => {
    expect(folded(0)).toHaveLength(1);
    expect(folded(Infinity)).toEqual([]);
  });
});

describe('describeFold', () => {
  it('回報摺疊範圍所屬的容器與成員數', () => {
    const state = stateOf({ a: { x: 1, y: 2 }, list: [1, 2, 3] });
    const [objectFold, arrayFold] = foldAtDepth(state, 1).map(
      (effect) => (effect as ReturnType<typeof foldEffect.of>).value,
    );
    expect(describeFold(state, objectFold as { from: number; to: number })).toEqual({
      size: 2,
      container: 'object',
    });
    expect(describeFold(state, arrayFold as { from: number; to: number })).toEqual({
      size: 3,
      container: 'array',
    });
  });
});
