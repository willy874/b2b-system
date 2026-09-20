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

export function jsonBody(body: unknown, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    body: JSON.stringify(body),
    headers: { ...(init.headers as Record<string, string>), 'content-type': 'application/json' },
  };
}
