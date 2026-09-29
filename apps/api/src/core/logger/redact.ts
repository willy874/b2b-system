/** 查詢字串裡屬於憑證的參數（啟用、重設密碼的 token）。 */
const SENSITIVE_QUERY_PARAM = /([?&]token=)[^&#]*/g;

export const REDACTED = '[Redacted]';

/** 把網址裡的 token 參數值換成 `[Redacted]`；其他部分原樣保留，排查時仍看得出是哪個端點。 */
export function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(SENSITIVE_QUERY_PARAM, `$1${REDACTED}`);
}

interface SerializedRequest {
  url?: string;
  headers?: Record<string, unknown>;
}

/**
 * pino-http 的 `req` serializer：`redact` 只能遮整個欄位，遮不了網址字串中的一段，
 * 所以 URL 與 Referer 在這裡處理（docs/conventions/03-backend.md §7：日誌不記 token）。
 */
export function redactRequest<T extends SerializedRequest>(req: T): T {
  req.url = redactUrl(req.url);
  const referer = req.headers?.referer;
  if (req.headers && typeof referer === 'string') req.headers.referer = redactUrl(referer);
  return req;
}
