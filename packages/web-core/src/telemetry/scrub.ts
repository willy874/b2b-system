/**
 * 上報前的遮罩（docs/architecture/frontend/19-observability.md §4）。apps/apm-service 收件時會再遮一次
 * （`apps/apm-service/src/ingest/scrub.ts`），兩邊的規則保持一致。
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** JWT（三段 base64url）。 */
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
/** 看起來像憑證的長字串：32 字以上的 base64url／hex，或 API token（`b2bt_…`）。 */
const LONG_TOKEN = /\b(?:b2bt_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{32,})\b/g;
/** 網址的 query string 與 fragment：重設密碼信的 `?token=`、OIDC 的 `?code=` 都在這裡。 */
const URL_QUERY = /(https?:\/\/[^\s"'?#]+|(?<![\w/])\/[^\s"'?#]*)[?#][^\s"']*/g;
/** 路徑裡的 id：UUID、純數字、24 碼以上的 hex。 */
const ID_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{24,})$/i;

const MAX_TEXT_LENGTH = 1000;

/** 錯誤訊息、breadcrumb 的文字：去掉 query string，遮掉 email 與憑證，截斷。 */
export function scrubText(value: string, maxLength: number = MAX_TEXT_LENGTH): string {
  const scrubbed = value
    .replace(URL_QUERY, '$1')
    .replace(JWT, '[token]')
    .replace(EMAIL, '[email]')
    .replace(LONG_TOKEN, '[token]');
  return scrubbed.length > maxLength ? `${scrubbed.slice(0, maxLength)}…` : scrubbed;
}

/**
 * 網址 → 不含 id 與 query 的形狀：`https://acme.example.com/api/users/3f…?x=1` → `/api/users/:id`。
 * 同源的網址只留 path；其他來源保留 origin（例：物件儲存的直傳網址）。
 */
export function toPathTemplate(
  value: string,
  origin: string = globalThis.location?.origin ?? '',
): string {
  let url: URL;
  try {
    url = new URL(value, origin || 'http://localhost');
  } catch {
    return scrubText(value, 200);
  }
  const path = url.pathname
    .split('/')
    .map((segment) => (ID_SEGMENT.test(segment) ? ':id' : segment))
    .join('/');
  return url.origin === origin || !/^[a-z][a-z0-9+.-]*:/i.test(value)
    ? path
    : `${url.origin}${path}`;
}
