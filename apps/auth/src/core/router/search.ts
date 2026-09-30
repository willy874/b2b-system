import { isSortEntry, toSortToken } from '@/shared/constants';

/**
 * 網址 search 的格式：重複的 key 就是陣列（`?sort=name&sort=-createdAt`），值一律是字串，
 * 型別轉換交給各 route 的 `validateSearch`（`z.coerce`、`sortSearchSchema`）。
 * 取代 TanStack Router 預設的 JSON 格式（`?sort=%5B%7B%22sort%22...`）。
 */
export function parseSearch(searchStr: string): Record<string, unknown> {
  const search: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(searchStr)) {
    const previous = search[key];
    search[key] = previous === undefined ? value : [previous, value].flat();
  }
  return search;
}

function toSearchValue(value: unknown): string {
  if (isSortEntry(value)) return toSortToken(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue;
      params.append(key, toSearchValue(item));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
