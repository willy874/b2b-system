import { randomBytes } from 'node:crypto';

/** token 的固定開頭：GitHub 等平台的 secret scanning 可以登記這個格式（docs/adr/0027-api-tokens-external-api.md D7）。 */
export const API_TOKEN_PREFIX = 'b2bt_';
/** secret 的位元組數：256 位元的隨機值，雜湊用 SHA-256 就夠，不需要慢雜湊。 */
const SECRET_BYTES = 32;
/** 管理頁顯示的 secret 前幾碼。 */
const SECRET_HINT_LENGTH = 4;

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** 16 位元組的 base62 最多 22 個字元：固定長度，解析時不必猜。 */
const UUID_BASE62_LENGTH = 22;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 租戶代碼的格式（`TENANT_CODE_PATTERN`）不含 `_`，所以能以 `_` 切開。 */
const TOKEN_PATTERN =
  /^b2bt_([a-z][a-z0-9-]{1,30}[a-z0-9])_([0-9A-Za-z]{22})_([0-9A-Za-z]{20,64})$/;

function toBase62(bytes: Uint8Array, length?: number): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let text = '';
  while (value > 0n) {
    text = ALPHABET[Number(value % 62n)] + text;
    value /= 62n;
  }
  return length === undefined ? text || '0' : text.padStart(length, '0');
}

function fromBase62(text: string, byteLength: number): Buffer | null {
  let value = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return null;
    value = value * 62n + BigInt(digit);
  }
  const hex = value.toString(16).padStart(byteLength * 2, '0');
  return hex.length === byteLength * 2 ? Buffer.from(hex, 'hex') : null;
}

function uuidToBase62(id: string): string {
  return toBase62(Buffer.from(id.replaceAll('-', ''), 'hex'), UUID_BASE62_LENGTH);
}

function base62ToUuid(text: string): string | null {
  const bytes = fromBase62(text, 16);
  if (!bytes) return null;
  const hex = bytes.toString('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID_PATTERN.test(id) ? id : null;
}

/** 新的 secret（base62）。 */
export function generateSecret(): string {
  return toBase62(randomBytes(SECRET_BYTES));
}

/** `b2bt_<租戶代碼>_<tokenId>_<secret>`；`tokenId` 是 `api_tokens.id` 的 base62。 */
export function formatToken(tenantCode: string, tokenId: string, secret: string): string {
  return `${API_TOKEN_PREFIX}${tenantCode}_${uuidToBase62(tokenId)}_${secret}`;
}

/** 管理頁顯示用：開頭到 secret 的前 4 碼（`api_tokens.prefix`）。 */
export function tokenPrefix(token: string): string {
  return token.slice(0, token.lastIndexOf('_') + 1 + SECRET_HINT_LENGTH);
}

export interface ParsedToken {
  tenantCode: string;
  tokenId: string;
  secret: string;
}

/**
 * 解析 token；格式不對回 null。租戶代碼只是「去哪個租戶 DB 找」的提示：secret 要在那裡比對成功才算數，
 * 改代碼不會換到別的租戶（D7）。
 */
export function parseToken(token: string): ParsedToken | null {
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const [, tenantCode, encodedId, secret] = match;
  const tokenId = encodedId ? base62ToUuid(encodedId) : null;
  if (!tenantCode || !tokenId || !secret) return null;
  return { tenantCode, tokenId, secret };
}
