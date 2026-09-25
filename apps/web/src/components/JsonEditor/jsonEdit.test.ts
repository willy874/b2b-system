import { describe, expect, it } from 'vitest';

import { formatPath, parsePath } from '../JsonViewer/jsonLines';
import {
  appendChild,
  convert,
  duplicate,
  fromEditText,
  insertAfter,
  removeIn,
  renameKey,
  setIn,
  toEditText,
} from './jsonEdit';

describe('路徑（parsePath / formatPath）', () => {
  it.each([
    ['$', []],
    ['$["a"][0]', ['a', 0]],
    ['$["a.b"]["[1]"]', ['a.b', '[1]']],
    ['$["say \\"hi\\""]', ['say "hi"']],
  ])('%s ↔ %j', (path, segments) => {
    expect(parsePath(path)).toEqual(segments);
    expect(formatPath(segments)).toBe(path);
  });
});

describe('jsonEdit（不可變操作）', () => {
  const root = { a: { b: 1 }, list: [1, 2], keep: { x: true } };

  it('setIn 只複製路徑上的容器，其他子樹沿用原參考', () => {
    const next = setIn(root, ['a', 'b'], 2) as typeof root;
    expect(next.a.b).toBe(2);
    expect(root.a.b).toBe(1);
    expect(next.keep).toBe(root.keep);
  });

  it('removeIn 刪物件的鍵與陣列元素', () => {
    expect(removeIn(root, ['list', 0])).toMatchObject({ list: [2] });
    expect(Object.keys(removeIn(root, ['a']) as object)).toEqual(['list', 'keep']);
  });

  it('renameKey 保留原本的順序，重複時丟錯', () => {
    expect(Object.keys(renameKey(root, ['list'], 'items') as object)).toEqual([
      'a',
      'items',
      'keep',
    ]);
    expect(() => renameKey(root, ['list'], 'a')).toThrow();
  });

  it('insertAfter：物件產生不重複的鍵名、陣列插在下一格', () => {
    const inObject = insertAfter({ a: 1, newKey: 2, c: 3 }, ['a'], '', 'newKey');
    expect(Object.keys(inObject.root as object)).toEqual(['a', 'newKey1', 'newKey', 'c']);
    expect(inObject.path).toEqual(['newKey1']);

    const inArray = insertAfter(root, ['list', 0], 9, 'newKey');
    expect(inArray.root).toMatchObject({ list: [1, 9, 2] });
    expect(inArray.path).toEqual(['list', 1]);
  });

  it('appendChild 加在容器最後；duplicate 複製在原節點後面', () => {
    expect(appendChild(root, ['list'], 3, 'k')).toMatchObject({
      root: { list: [1, 2, 3] },
      path: ['list', 2],
    });
    const copied = duplicate(root, ['a']);
    expect(Object.keys(copied.root as object)).toEqual(['a', 'a1', 'list', 'keep']);
  });

  it.each([
    [{ a: 1 }, 'array', [1]],
    [[1, 2], 'object', { 0: 1, 1: 2 }],
    [5, 'array', [5]],
    [5, 'object', { value: 5 }],
    [{ a: 1 }, 'value', '{"a":1}'],
  ] as const)('convert(%j, %s)', (node, target, expected) => {
    expect(convert(node, target)).toEqual(expected);
  });
});

describe('編輯框文字（toEditText / fromEditText）', () => {
  it.each([
    ['123', 123],
    ['-1.5e3', -1500],
    ['true', true],
    ['null', null],
    ['hello', 'hello'],
    ['"123"', '123'],
    ['01', '01'],
  ])('%s → %j', (text, value) => {
    expect(fromEditText(text)).toEqual(value);
  });

  it.each(['123', 'true', 'hello', '"quoted"', '', 42, false, null])(
    '原樣送出不改變型別：%j',
    (value) => {
      expect(fromEditText(toEditText(value))).toEqual(value);
    },
  );
});
