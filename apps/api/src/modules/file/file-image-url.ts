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
  fileId: string;
  variant: ImageVariant;
  /** Unix 秒。 */
  expiresAt: number;
}

/** 由 api 自己的祕密衍生，與 JWT 的簽章金鑰分開用途。 */
export function deriveImageUrlKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('file-image-url/v1').digest();
}

export function signImageUrl(key: Buffer, claims: ImageUrlClaims): string {
  return createHmac('sha256', key)
    .update(`${claims.fileId}\n${claims.variant}\n${claims.expiresAt}`)
    .digest('base64url');
}

export function verifyImageUrl(key: Buffer, claims: ImageUrlClaims, signature: string): boolean {
  const expected = Buffer.from(signImageUrl(key, claims));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
