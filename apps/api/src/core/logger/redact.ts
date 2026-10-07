import { stdSerializers } from 'pino';

import { describeDbError } from '../errors';
import { redactQuery, redactUrl } from './sensitive-query';

export { REDACTED, redactQuery, redactUrl, SENSITIVE_QUERY_KEYS } from './sensitive-query';

interface SerializedRequest {
  url?: string;
  query?: unknown;
  headers?: Record<string, unknown>;
}

/**
 * pino-http 的 `req` serializer：`redact` 只能遮整個欄位，遮不了網址字串中的一段，
 * 所以 URL、`query` 與 Referer 在這裡處理（docs/coding-standards/03-backend.md §7：日誌不記 token）。
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
