/** 把物件轉成 query string（undefined / 空字串略過，陣列展開成重複 key）。 */
export function withQuery(url: string, params?: Record<string, unknown>): string {
  if (!params) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${url}?${query}` : url;
}

/** 以 JSON 送出 body；保留呼叫端的 headers（物件、陣列或 `Headers` 皆可）。 */
export function jsonBody(body: unknown, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return { ...init, body: JSON.stringify(body), headers };
}
