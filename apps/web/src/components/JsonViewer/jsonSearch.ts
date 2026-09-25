import { formatPath } from './jsonLines';
import type { JsonPath } from './jsonLines';

export interface JsonSearchMatch {
  /** 符合的那一行的路徑字串（與 `toJsonLines` 相同）。 */
  path: string;
  /** 鍵名符合或值符合；同一行可能兩者都符合，各算一筆。 */
  target: 'key' | 'value';
}

/** 搜尋值的文字：字串不帶引號，其他基本型別是 JSON 字面。 */
function valueText(value: unknown): string {
  return typeof value === 'string' ? value : String(JSON.stringify(value) ?? value);
}

/**
 * 在整份資料（不只展開中的行）裡找鍵名與基本型別的值，不分大小寫，依文件順序回傳。
 * 以迴圈走訪，資料很深也不會爆堆疊；循環參照只走一次。
 */
export function searchJson(value: unknown, query: string): JsonSearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  const matches: JsonSearchMatch[] = [];
  const visited = new Set<object>();
  const stack: Array<{ node: unknown; path: JsonPath }> = [{ node: value, path: [] }];

  while (stack.length > 0) {
    const { node, path } = stack.pop() as { node: unknown; path: JsonPath };
    const key = path.at(-1);
    if (typeof key === 'string' && key.toLowerCase().includes(needle)) {
      matches.push({ path: formatPath(path), target: 'key' });
    }
    if (typeof node !== 'object' || node === null) {
      if (valueText(node).toLowerCase().includes(needle)) {
        matches.push({ path: formatPath(path), target: 'value' });
      }
      continue;
    }
    if (visited.has(node)) continue;
    visited.add(node);
    const entries: Array<[string | number, unknown]> = Array.isArray(node)
      ? node.map((item, index) => [index, item])
      : Object.entries(node);
    // 反向推入，出堆疊時才會是文件順序
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [entryKey, entryValue] = entries[index] as [string | number, unknown];
      stack.push({ node: entryValue, path: [...path, entryKey] });
    }
  }
  return matches;
}
