import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { installFakeListLayout } from '@/test/fakeLayout';

import { diffJsonLines, tokenizeJsonLine, toJsonDiffRows } from './diffLines';
import { JsonDiff } from './JsonDiff';

const summarize = (before: unknown, after: unknown) =>
  diffJsonLines(before, after).map((line) => `${line.kind[0]} ${line.text}`);

const items = () => Array.from(document.querySelectorAll('[data-testid="json-diff-item"]'));

/** 每一行的「標記 ＋ 內容」（不含行號欄）。 */
const lineTexts = () =>
  items().map((line) => `${line.children[1]?.textContent}${line.children[2]?.textContent}`);

describe('diffJsonLines', () => {
  it('只標出改變的行；同一段先刪除、再新增', () => {
    expect(summarize({ name: 'a', count: 1 }, { name: 'b', count: 1 })).toEqual([
      'e {',
      'r   "name": "a",',
      'a   "name": "b",',
      'e   "count": 1',
      'e }',
    ]);
  });

  it('陣列尾端新增一項：原本最後一行只差逗號，視為沒變', () => {
    expect(summarize({ permissions: ['a'] }, { permissions: ['a', 'b'] })).toEqual([
      'e {',
      'e   "permissions": [',
      'e     "a",',
      'a     "b"',
      'e   ]',
      'e }',
    ]);
  });

  it('一邊是 undefined（建立／刪除）時，另一邊整份是新增／刪除', () => {
    expect(summarize(undefined, { a: 1 })).toEqual(['a {', 'a   "a": 1', 'a }']);
    expect(summarize({ a: 1 }, undefined)).toEqual(['r {', 'r   "a": 1', 'r }']);
    expect(summarize(undefined, undefined)).toEqual([]);
  });

  it('舊版與新版各自的行號', () => {
    const lines = diffJsonLines({ a: 1, b: 2 }, { b: 2 });
    expect(lines.map((line) => [line.oldLineNumber, line.newLineNumber])).toEqual([
      [1, 1],
      [2, undefined],
      [3, 2],
      [4, 3],
    ]);
  });

  it('大份資料只改一行也能正確比對', () => {
    const before = Array.from({ length: 5000 }, (_, index) => index);
    const after = before.map((value) => (value === 2500 ? -1 : value));
    const changed = diffJsonLines(before, after).filter((line) => line.kind !== 'equal');
    expect(changed.map((line) => `${line.kind} ${line.text.trim()}`)).toEqual([
      'removed 2500,',
      'added -1,',
    ]);
  });
});

describe('toJsonDiffRows', () => {
  const lines = diffJsonLines(
    Array.from({ length: 20 }, (_, index) => index),
    Array.from({ length: 20 }, (_, index) => (index === 10 ? 'x' : index)),
  );

  it('變更前後保留 context 行，其餘收成摺疊列', () => {
    const rows = toJsonDiffRows(lines, 2, new Set());
    expect(rows.map((row) => (row.kind === 'fold' ? `fold ${row.count}` : row.kind))).toEqual([
      'fold 9',
      'equal',
      'equal',
      'removed',
      'added',
      'equal',
      'equal',
      'fold 8',
    ]);
  });

  it('展開的區段整段顯示；只有一行的區段不收', () => {
    const rows = toJsonDiffRows(lines, 2, new Set([0]));
    expect(rows.filter((row) => row.kind === 'fold')).toHaveLength(1);
    expect(toJsonDiffRows(lines, 10, new Set()).filter((row) => row.kind === 'fold')).toEqual([]);
  });
});

describe('tokenizeJsonLine', () => {
  it('鍵名、字串、數字、布林、null 與標點分開上色，接起來是原本的文字', () => {
    const line = '  "key": "va\\"l", 1.5e3, true, null, [],';
    const tokens = tokenizeJsonLine(line);
    expect(tokens.map((token) => token.text).join('')).toBe(line);
    expect(tokens.filter((token) => token.kind !== 'space').map((token) => token.kind)).toEqual([
      'key',
      'punctuation',
      'string',
      'punctuation',
      'number',
      'punctuation',
      'boolean',
      'punctuation',
      'null',
      'punctuation',
      'punctuation',
      'punctuation',
      'punctuation',
    ]);
  });
});

describe('JsonDiff', () => {
  let layout: ReturnType<typeof installFakeListLayout> | undefined;
  afterEach(() => {
    layout?.restore();
    layout = undefined;
  });

  it('以 +／- 標出新增與刪除的行，data-value 是行的種類', () => {
    render(<JsonDiff before={{ roles: ['member'] }} after={{ roles: ['member', 'auditor'] }} />);
    expect(lineTexts()).toEqual([
      ' {',
      '   "roles": [',
      '     "member",',
      '+    "auditor"',
      '   ]',
      ' }',
    ]);
    expect(items().map((line) => line.getAttribute('data-value'))).toContain('added');
  });

  it('點摺疊列展開未變更的區段；換一份資料時回到預設', () => {
    const before = Array.from({ length: 20 }, (_, index) => index);
    const after = before.map((value) => (value === 19 ? 'x' : value));
    const { rerender } = render(
      <JsonDiff
        before={before}
        after={after}
        labels={{ expandUnchanged: (count) => `show ${count}` }}
      />,
    );
    expect(items()).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'show 17' }));
    expect(items()).toHaveLength(23);

    rerender(<JsonDiff before={[...before]} after={after} />);
    expect(items()).toHaveLength(6);
  });

  it('沒有變更時顯示 labels.empty', () => {
    render(<JsonDiff before={{ a: 1 }} after={{ a: 1 }} labels={{ empty: 'none' }} />);
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(items()).toEqual([]);
  });

  it('套用 maxHeight，aria-label 讓捲動框成為 region', () => {
    render(<JsonDiff before={1} after={2} maxHeight={120} aria-label="變更" data-testid="diff" />);
    const diff = screen.getByRole('region', { name: '變更' });
    expect(diff).toHaveStyle({ maxHeight: '120px' });
    expect(diff).toHaveAttribute('data-testid', 'diff');
  });

  it('列數超過門檻時只渲染可視範圍', () => {
    layout = installFakeListLayout({ rowHeight: 20, viewportHeight: 200 });
    render(
      <JsonDiff before={undefined} after={Array.from({ length: 1000 }, (_, index) => index)} />,
    );
    expect(items().length).toBeLessThan(40);
  });
});
