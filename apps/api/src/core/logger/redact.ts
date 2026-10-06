import { stdSerializers } from 'pino';

import { describeDbError } from '../errors';

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

interface SerializedRequest {
  url?: string;
  query?: unknown;
  headers?: Record<string, unknown>;
}

/**
 * pino-http 的 `req` serializer：`redact` 只能遮整個欄位，遮不了網址字串中的一段，
 * 所以 URL、`query` 與 Referer 在這裡處理（docs/conventions/03-backend.md §7：日誌不記 token）。
 * pino-std-serializers 交過來的 `query`、`headers` 是請求本身的物件，所以換成遮好的拷貝，不改到請求。
 */
export function redactRequest<T extends SerializedRequest>(req: T): T {
  req.url = redactUrl(req.url);
  if (req.query !== undefined) req.query = redactQuery(req.query);
  const referer = req.headers?.referer;
  if (req.headers && typeof referer === 'string') {
    req.headers = { ...req.headers, referer: redactUrl(referer) };
  }
  return req;
}

/** pino-std-serializers 序列化過的錯誤：`raw` 是原本的錯誤（不可列舉，不會輸出）。 */
function isSerializedError(value: unknown): value is { raw: unknown } {
  return typeof value === 'object' && value !== null && 'raw' in value;
}

/**
 * pino 的 `err` serializer：資料庫的查詢錯誤換成不含參數的描述（`describeDbError`），
 * 其他錯誤照 pino 的標準 serializer。pino-http 會先以標準 serializer 處理再交給這裡，所以兩種輸入都要接受。
 * 存取日誌與應用程式日誌（`new Logger(…)` 的 `{ err }`）共用這個 Pino，兩者都生效。
 */
export function serializeError(value: unknown): unknown {
  const raw = isSerializedError(value) ? value.raw : value;
  const described = describeDbError(raw);
  if (described) return described;
  if (isSerializedError(value) || !(raw instanceof Error)) return value;
  return stdSerializers.err(raw);
}
