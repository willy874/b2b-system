const ALLOWED_LINK_PROTOCOLS = new Set(['http', 'https', 'mailto']);

/** 網址的協定（RFC 3986 的 scheme）。 */
const SCHEME = /^([a-z][a-z\d+.-]*):/i;

/** 空白與控制字元：瀏覽器解析網址時會略過 tab、換行（`java\tscript:`），一律不接受。 */
// oxlint-disable-next-line no-control-regex -- 就是要比對控制字元
const UNSAFE_CHARACTERS = /[\s\u0000-\u001f\u007f]/;

/**
 * 連結可以用的網址：`http:`、`https:`、`mailto:`，或站內的絕對路徑（`/path`，不含 `//host`）。
 * `javascript:`、`data:` 等其他協定一律不接受。編輯器（輸入、貼上）、後端驗證、轉成 HTML、顯示時都用這一個判斷。
 */
export function isSafeLinkHref(href: unknown): href is string {
  if (typeof href !== 'string' || href === '' || UNSAFE_CHARACTERS.test(href)) return false;
  if (href.startsWith('/')) return !href.startsWith('//') && !href.startsWith('/\\');
  // 不用 `new URL()`：這個 package 不依賴 DOM 或 Node 的型別。不是絕對網址也不是站內路徑（`example.com`）時不接受
  const scheme = SCHEME.exec(href)?.[1]?.toLowerCase();
  return scheme !== undefined && ALLOWED_LINK_PROTOCOLS.has(scheme);
}

/**
 * 使用者輸入的網址：沒寫協定的補上 `https://`（`example.com` → `https://example.com`）。
 * 轉換後仍要以 `isSafeLinkHref` 檢查。
 */
export function normalizeLinkHref(input: string): string {
  const value = input.trim();
  if (value === '' || value.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  return `https://${value}`;
}
