import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

/** `<RichTable` 的開始標籤（到深度 0 的第一個 `>`；props 裡的箭頭函式在 `{}` 之內，不會提早結束）。 */
function openingTags(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/<RichTable\b/g)) {
    let depth = 0;
    let index = match.index + match[0].length;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) break;
    }
    tags.push(source.slice(match.index, index + 1));
  }
  return tags;
}

/**
 * 列表查詢失敗時要顯示錯誤與重試，不能落到「沒有資料」
 * （docs/architecture/frontend/07-ui-system.md §6.1）：每個 `<RichTable` 都要傳 `error`。
 */
describe('RichTable 的查詢錯誤', () => {
  it('每個 <RichTable 都帶 error', () => {
    const offenders = walk(SRC).flatMap((file) =>
      openingTags(readFileSync(file, 'utf8'))
        .filter((tag) => !/\berror=/.test(tag))
        .map(() => relative(SRC, file)),
    );
    expect(offenders, `沒有傳 error 的 RichTable：${offenders.join(', ')}`).toEqual([]);
  });

  it('掃描得到 RichTable（避免路徑寫錯而永遠通過）', () => {
    const count = walk(SRC).reduce(
      (total, file) => total + openingTags(readFileSync(file, 'utf8')).length,
      0,
    );
    expect(count).toBeGreaterThan(0);
  });
});
