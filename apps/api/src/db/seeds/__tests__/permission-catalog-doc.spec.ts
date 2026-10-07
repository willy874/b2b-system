import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_PERMISSION_KEYS, PERMISSION_DEPENDENCIES } from '../permissions';

const CATALOG_DOC = resolve(
  __dirname,
  '../../../../../../docs/architecture/iam/02-permission-catalog.md',
);

/** 某個 `## N.` 章節的內容（到下一個同級標題為止）。 */
function section(markdown: string, number: number): string {
  const start = markdown.indexOf(`\n## ${number}. `);
  if (start < 0) throw new Error(`找不到 §${number}`);
  const end = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, end < 0 ? undefined : end);
}

/** 表格一列的欄位（去掉前後的 `|`）。 */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** 欄位裡的反引號權限鍵。 */
function keysIn(cell: string): string[] {
  return [...cell.matchAll(/`([A-Za-z]+:[A-Za-z]+)`/g)].map((match) => match[1] as string);
}

describe('權限目錄的文件與 seed 一致（docs/architecture/iam/02-permission-catalog.md）', () => {
  const markdown = readFileSync(CATALOG_DOC, 'utf8');

  it('§2 列出的權限鍵 = PERMISSION_SEED', () => {
    const documented = section(markdown, 2)
      .split('\n')
      .filter((line) => /^\|\s*`[A-Za-z]+:[A-Za-z]+`/.test(line))
      .flatMap((line) => keysIn(cells(line)[0] ?? ''));
    expect(documented.toSorted()).toEqual([...ALL_PERMISSION_KEYS].toSorted());
  });

  it('§9.1 的依賴樹 = PERMISSION_DEPENDENCIES', () => {
    const rows = section(markdown, 9)
      .split('\n')
      .filter((line) => /^\|\s*`[A-Za-z]+:[A-Za-z]+`/.test(line))
      .map(cells);
    const documented = Object.fromEntries(
      rows.map(([key = '', includes = '', requires = '']) => [
        keysIn(key)[0],
        { includes: keysIn(includes), requires: keysIn(requires) },
      ]),
    );
    const seeded = Object.fromEntries(
      Object.entries(PERMISSION_DEPENDENCIES).map(([key, entry]) => [
        key,
        {
          includes: [...('includes' in entry ? entry.includes : [])],
          requires: [...('requires' in entry ? entry.requires : [])],
        },
      ]),
    );
    expect(documented).toEqual(seeded);
  });
});
