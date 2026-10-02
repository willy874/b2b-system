import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const srcDir = resolve(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full);
    return /\.tsx?$/.test(entry) && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

/** SQL 樣板裡無法呼叫 `notDeleted()` 的條件（別名、遞迴 CTE），在同一行標上這個註解才放行。 */
const RAW_SQL_MARKER = '/* notDeleted */';

/** `isNull(users.deletedAt)`、`isNull(child.deletedAt)`…：改用 `notDeleted(table)`。 */
const HAND_WRITTEN_IS_NULL = /\bisNull\(\s*[\w.]+\.deletedAt\s*\)/;
/** `${users.deletedAt} IS NULL`：改用 `${notDeleted(users)}`；`IS NOT NULL` 改用 `isDeleted(table)`。 */
const TEMPLATE_DELETED_AT = /\$\{[\w.]+\.deletedAt\}\s+IS\s+(NOT\s+)?NULL/i;
/** 手寫的 `deleted_at IS NULL`（別名、CTE）：同一行要有 `RAW_SQL_MARKER`。 */
const RAW_DELETED_AT = /\bdeleted_at\s+IS\s+NULL/i;

interface Offense {
  file: string;
  line: number;
  text: string;
}

const offenses: Offense[] = ['modules', 'core'].flatMap((layer) =>
  walk(resolve(srcDir, layer)).flatMap((full) => {
    const file = relative(srcDir, full);
    return readFileSync(full, 'utf8')
      .split('\n')
      .flatMap((text, index) => {
        const bad =
          HAND_WRITTEN_IS_NULL.test(text) ||
          TEMPLATE_DELETED_AT.test(text) ||
          (RAW_DELETED_AT.test(text) && !text.includes(RAW_SQL_MARKER));
        return bad ? [{ file, line: index + 1, text: text.trim() }] : [];
      });
  }),
);

describe('軟刪除的條件一律經過 notDeleted()（docs/architecture/backend/14-revisions.md §9.2 D8）', () => {
  it('modules/、core/ 沒有手寫的 isNull(x.deletedAt) 或未標註的 deleted_at IS NULL', () => {
    const report = offenses.map(({ file, line, text }) => `${file}:${line}  ${text}`).join('\n');
    expect(offenses, report).toEqual([]);
  });

  it('規則本身抓得到三種寫法，也放行標註過的 SQL 樣板', () => {
    expect(HAND_WRITTEN_IS_NULL.test('.where(isNull(users.deletedAt))')).toBe(true);
    expect(TEMPLATE_DELETED_AT.test('AND ${users.deletedAt} IS NULL')).toBe(true);
    expect(TEMPLATE_DELETED_AT.test('sql`${users.deletedAt} IS NOT NULL`')).toBe(true);
    expect(RAW_DELETED_AT.test('WHERE f.deleted_at IS NULL')).toBe(true);
    expect('WHERE f.deleted_at IS NULL /* notDeleted */'.includes(RAW_SQL_MARKER)).toBe(true);
  });
});
