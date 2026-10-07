import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ImageVariant } from './file.constants';

/**
 * 影像 API（`GET /files/:id/image/:variant`）的網址簽章（docs/architecture/backend/09-file.md §5.4）。
 *
 * `<img src>` 帶不了 Authorization 標頭（access token 只在記憶體），所以這個端點是 `@Public()`，
 * 改以網址上的簽章授權：只有查得到檔案（`file:read`）的人才拿得到網址，網址本身在 `exp` 之前有效——
 * 與 presigned URL 相同的模型。`format` 不在簽章內：它只決定編碼方式，不擴大能讀到的內容。
 */

export interface ImageUrlClaims {
  /** 簽發時的租戶：網址換到別的租戶的網域就驗不過（v2）。 */
  tenantId: string;
  fileId: string;
  variant: ImageVariant;
  /** Unix 秒。 */
  expiresAt: number;
}

/** v2 的簽章前綴：與沒有前綴的 v1 區分（過渡期兩者並存，docs/architecture/backend/09-file.md §5.4）。 */
const V2_PREFIX = 'v2.';

/** 舊（v1）的金鑰：由 `JWT_SECRET` 衍生。只在過渡期驗證，不再簽發。 */
export function deriveLegacyImageUrlKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('file-image-url/v1').digest();
}

function hmac(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('base64url');
}

function sameString(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** v2：簽章內容帶版本與租戶；金鑰是獨立的 `FILE_URL_SIGNING_KEY`。 */
export function signImageUrl(key: Buffer, claims: ImageUrlClaims): string {
  return `${V2_PREFIX}${hmac(key, `v2\n${claims.tenantId}\n${claims.fileId}\n${claims.variant}\n${claims.expiresAt}`)}`;
}

/**
 * 驗證網址簽章：`v2.` 開頭以 v2 驗證；沒有前綴的是 v1（不含租戶），只在還有舊金鑰（過渡期）時接受。
 */
export function verifyImageUrl(
  keys: { current: Buffer; legacy: Buffer | undefined },
  claims: ImageUrlClaims,
  signature: string,
): boolean {
  if (signature.startsWith(V2_PREFIX))
    return sameString(signature, signImageUrl(keys.current, claims));
  if (!keys.legacy) return false;
  return sameString(
    signature,
    hmac(keys.legacy, `${claims.fileId}\n${claims.variant}\n${claims.expiresAt}`),
  );
}
