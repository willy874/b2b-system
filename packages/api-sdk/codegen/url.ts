/**
 * URL builder 共用的執行期：零依賴（不 import zod、不 import `runtime.ts`）。
 * 主入口（`@b2b-system/api-sdk`）在執行期只會用到這個檔案、`models.ts` 的 enum 與 `endpoints/*` 的 URL builder，
 * 打包器才能把沒用到的 zod schema 與 `request()` 整個排除在外。
 *
 * 這個檔案由產生器原樣複製到輸出目錄（與 `runtime.ts` 同層，`runtime.ts` 以 `./url` 引用它）。
 */

/** 路徑樣板 ＋ 參數 → 相對 URL（不含 baseUrl）。 */
export function buildUrl(template: string, path?: object, query?: object): string {
  const values = (path ?? {}) as Record<string, unknown>;
  const resolved = template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined || value === null)
      throw new Error(`缺少 path 參數「${name}」（${template}）`);
    return encodeURIComponent(String(value));
  });
  return `${resolved}${serializeQuery(query)}`;
}

/**
 * OpenAPI 預設的 `form` + `explode`：陣列展開成重複的 key；物件以 `deepObject`（`a[b]=c`）表示。
 * `undefined` / `null` 略過。
 */
export function serializeQuery(query?: object): string {
  if (!query) return '';
  const search = new URLSearchParams();
  const append = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const item of value) append(key, item);
    } else if (value instanceof Date) {
      search.append(key, value.toISOString());
    } else if (typeof value === 'object') {
      for (const [child, childValue] of Object.entries(value))
        append(`${key}[${child}]`, childValue);
    } else {
      search.append(key, String(value));
    }
  };
  for (const [key, value] of Object.entries(query)) append(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
}
