import { hkdfSync } from 'node:crypto';

/** 一把對稱的簽章金鑰：`kid` 寫進 JWT 的 header，驗證時依它選金鑰。 */
export interface SigningKey {
  kid: string;
  key: Buffer;
}

/** 金鑰環：第一把簽發，全部都能驗證（輪替時新舊並存，docs/architecture/backend/04-auth.md §11）。 */
export interface SigningKeyRing {
  signing: SigningKey;
  byKid: ReadonlyMap<string, Buffer>;
}

const KID = /^[A-Za-z0-9_-]{1,32}$/;
/** HS256 的金鑰至少 32 bytes（與雜湊輸出等長）。 */
export const MIN_SIGNING_KEY_BYTES = 32;

/**
 * `<kid>:<base64 金鑰>[,<kid>:<base64 金鑰>…]` → 金鑰環；格式不對回錯誤訊息（給環境變數驗證用）。
 * `kid` 限英數、`_`、`-`，1～32 字，不可重複；每把金鑰 base64 解開至少 32 bytes。
 */
export function parseSigningKeys(value: string): SigningKeyRing | string {
  const keys: SigningKey[] = [];
  for (const entry of value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const separator = entry.indexOf(':');
    if (separator <= 0) return '格式是 <kid>:<base64 金鑰>，多把以逗號分隔';
    const kid = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), 'base64');
    if (!KID.test(kid)) return `kid「${kid}」只能是英數、_、-，1～32 字`;
    if (keys.some((existing) => existing.kid === kid)) return `kid「${kid}」重複`;
    if (key.length < MIN_SIGNING_KEY_BYTES) {
      return `kid「${kid}」的金鑰解開後不到 ${MIN_SIGNING_KEY_BYTES} bytes（openssl rand -base64 48）`;
    }
    if (new Set(key).size < 16) return `kid「${kid}」的金鑰熵太低`;
    keys.push({ kid, key });
  }
  const [signing] = keys;
  if (!signing) return '至少要有一把金鑰';
  return { signing, byKid: new Map(keys.map(({ kid, key }) => [kid, key])) };
}

/**
 * 開發環境沒設定金鑰環時，由 `JWT_SECRET` 以 HKDF 推導一把（每個用途不同）：重啟後仍是同一把，
 * 租戶與平台的 token 也不會共用金鑰。production 一律要明確設定（`env.schema.ts`）。
 */
export function deriveSigningKeyRing(seed: string, purpose: string): SigningKeyRing {
  const key = Buffer.from(hkdfSync('sha256', seed, 'b2b-system', purpose, MIN_SIGNING_KEY_BYTES));
  const kid = `dev-${purpose.replaceAll(/[^A-Za-z0-9_-]/g, '-')}`.slice(0, 32);
  return { signing: { kid, key }, byKid: new Map([[kid, key]]) };
}

/** 由種子推導單一用途的金鑰（縮圖網址等不需要 `kid` 的 HMAC）。 */
export function deriveKey(seed: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', seed, 'b2b-system', purpose, MIN_SIGNING_KEY_BYTES));
}
