/*
 * 憑證參數的遮蔽，不依賴任何套件：日誌（`redact.ts`）與 tracing（`src/instrumentation.ts`，在其他模組載入之前執行）共用。
 */

/**
 * 查詢字串裡屬於憑證的參數，唯一的一份名單：網址字串與解析好的 `query` 物件都由它遮蔽。
 * 啟用、重設密碼的 `token`；外部 IdP 回來的授權碼 `code` 與 `state`；完成外部登入的 `ticket`
 * （另發的一次性隨機值）；以及 OIDC 的 `code_verifier`、`id_token_hint`（含 email 與名稱的 ID token）。
 */
export const SENSITIVE_QUERY_KEYS = [
  'token',
  'code',
  'state',
  'ticket',
  'code_verifier',
  'id_token_hint',
] as const;

const SENSITIVE_KEYS: ReadonlySet<string> = new Set(SENSITIVE_QUERY_KEYS);

const SENSITIVE_QUERY_PARAM = new RegExp(`([?&](?:${SENSITIVE_QUERY_KEYS.join('|')})=)[^&#]*`, 'g');

export const REDACTED = '[Redacted]';

/** 把網址裡屬於憑證的參數值換成 `[Redacted]`；其他部分原樣保留，排查時仍看得出是哪個端點。 */
export function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(SENSITIVE_QUERY_PARAM, `$1${REDACTED}`);
}

/**
 * 解析好的查詢參數（Express 的 `req.query`）：回傳淺拷貝，憑證參數的值換成 `[Redacted]`，其他參數照常保留。
 * 同名參數出現多次（陣列）或巢狀的值也整個換掉。
 */
export function redactQuery(query: unknown): unknown {
  if (typeof query !== 'object' || query === null) return query;
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, SENSITIVE_KEYS.has(key) ? REDACTED : value]),
  );
}
