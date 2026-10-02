import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { formatToken, generateSecret, parseToken, tokenPrefix } from '../api-token.format';

describe('API token 的格式（docs/architecture/06-external-api.md §9.2 D7）', () => {
  it('format → parse 還原租戶代碼、token id 與 secret', () => {
    for (let index = 0; index < 50; index += 1) {
      const tokenId = randomUUID();
      const secret = generateSecret();
      const token = formatToken('acme-games', tokenId, secret);
      expect(token.startsWith('b2bt_acme-games_')).toBe(true);
      expect(parseToken(token)).toEqual({ tenantCode: 'acme-games', tokenId, secret });
    }
  });

  it('token id 固定 22 碼：開頭是 0 的 uuid 也能還原', () => {
    const tokenId = '00000000-0000-4000-8000-000000000001';
    const token = formatToken('acme', tokenId, generateSecret());
    expect(token.split('_')[2]).toHaveLength(22);
    expect(parseToken(token)?.tokenId).toBe(tokenId);
  });

  it('secret 每次不同，只含 base62 字元', () => {
    const secrets = new Set(Array.from({ length: 20 }, () => generateSecret()));
    expect(secrets.size).toBe(20);
    for (const secret of secrets) expect(secret).toMatch(/^[0-9A-Za-z]{40,43}$/);
  });

  it.each([
    ['不是 b2bt_ 開頭', 'eyJhbGciOiJIUzI1NiJ9.x.y'],
    ['少一段', 'b2bt_acme_0000000000000000000001'],
    ['租戶代碼不合格式', `b2bt_ACME_${'1'.repeat(22)}_${'a'.repeat(43)}`],
    ['token id 長度不對', `b2bt_acme_${'1'.repeat(21)}_${'a'.repeat(43)}`],
    ['token id 超出 128 位元', `b2bt_acme_${'z'.repeat(22)}_${'a'.repeat(43)}`],
    ['secret 有不合法的字元', `b2bt_acme_${'1'.repeat(22)}_${'a'.repeat(40)}-+/`],
  ])('格式不對回 null：%s', (_label, token) => {
    expect(parseToken(token)).toBeNull();
  });

  it('prefix 是開頭到 secret 的前 4 碼，不含 secret 的其餘部分', () => {
    const secret = generateSecret();
    const token = formatToken('acme', randomUUID(), secret);
    const prefix = tokenPrefix(token);
    expect(token.startsWith(prefix)).toBe(true);
    expect(prefix.endsWith(`_${secret.slice(0, 4)}`)).toBe(true);
  });
});
