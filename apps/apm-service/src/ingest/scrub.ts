/**
 * 伺服器端的遮罩（docs/architecture/frontend/19-observability.md §9.2 D7）：前端的 `beforeSend` 已經遮過一次，這裡兜底——
 * SDK 升級、設定錯誤或有人直接打收件端點時，個資也不會落地。
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** JWT（三段 base64url）。 */
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
/** 看起來像憑證的長字串：32 字以上的 base64url／hex，或 apps/api 的 API token（`b2bt_…`）。 */
const LONG_TOKEN = /\b(?:b2bt_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{32,})\b/g;
/** 網址的 query string 與 fragment：重設密碼信的 `?token=`、OIDC 的 `?code=` 都在這裡。 */
const URL_QUERY = /(https?:\/\/[^\s"'?#]+|(?<![\w/])\/[^\s"'?#]*)[?#][^\s"']*/g;

export function scrubText(value: string, maxLength: number): string {
  const scrubbed = value
    .replace(URL_QUERY, '$1')
    .replace(JWT, '[token]')
    .replace(EMAIL, '[email]')
    .replace(LONG_TOKEN, '[token]');
  return scrubbed.length > maxLength ? `${scrubbed.slice(0, maxLength)}…` : scrubbed;
}

/** 網址只留 path（不含 query、fragment）；完整網址保留 origin。 */
export function scrubUrl(value: string): string {
  const cut = value.search(/[?#]/);
  const withoutQuery = cut === -1 ? value : value.slice(0, cut);
  return scrubText(withoutQuery, 500);
}

export function asString(value: unknown, maxLength: number): string | undefined {
  if (typeof value === 'string') return scrubText(value, maxLength);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}
