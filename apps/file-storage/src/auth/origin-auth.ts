import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/** CDN 邊緣回源時帶的標頭（deploy/nginx.cdn.conf）。 */
export const ORIGIN_AUTH_HEADER = 'x-origin-auth';

/** 只有讀取可以用回源憑證：其他方法即使帶了正確的值也照舊要 SigV4。 */
const ORIGIN_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

function digest(value: string): Buffer {
  // 先雜湊成固定長度再比對：timingSafeEqual 要求等長，長度本身也不該從比對時間洩漏
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * CDN 的回源憑證（docs/architecture/03-file-storage.md §3.3）：這個請求是否以 `X-Origin-Auth` 通過驗證、可以略過 SigV4。
 *
 * 條件：設定了 `FILE_STORAGE_ORIGIN_SECRET`、方法是 GET／HEAD、對象是一個物件（不是列表或 bucket 操作）、
 * 沒有 `response-*` 參數、標頭的值以常數時間比對相符。任何一個不符就回 false，請求照常走 SigV4（沒有簽章就是 AccessDenied）。
 */
export function isOriginAuthorized(
  request: {
    method: string;
    headers: IncomingHttpHeaders;
    key: string | undefined;
    /** 查詢參數的名稱。 */
    queryNames?: readonly string[];
  },
  secret: string | undefined,
): boolean {
  if (!secret || !ORIGIN_METHODS.has(request.method) || request.key === undefined) return false;
  // 回應標頭的覆寫（response-content-type 等）只給 presigned 網址用：邊緣快取的是共用的內容，不能讓請求改寫它
  if (request.queryNames?.some((name) => name.toLowerCase().startsWith('response-'))) return false;
  const raw = request.headers[ORIGIN_AUTH_HEADER];
  const presented = Array.isArray(raw) ? undefined : raw;
  if (!presented) return false;
  return timingSafeEqual(digest(presented), digest(secret));
}
