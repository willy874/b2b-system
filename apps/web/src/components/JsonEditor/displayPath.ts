import type { JsonPath } from '../JsonViewer/jsonLines';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** 給人看的路徑：`stats.hp`、`skills[0]`、`["a b"]`；根節點用 `rootLabel`。 */
export function formatDisplayPath(path: JsonPath, rootLabel: string): string {
  if (path.length === 0) return rootLabel;
  return path
    .map((segment, index) => {
      if (typeof segment === 'number') return `[${segment}]`;
      if (!IDENTIFIER.test(segment)) return `[${JSON.stringify(segment)}]`;
      return index === 0 ? segment : `.${segment}`;
    })
    .join('');
}
