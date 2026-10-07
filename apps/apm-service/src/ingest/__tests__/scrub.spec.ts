import { scrubText, scrubUrl } from '../scrub';

describe('scrubText（伺服器端的遮罩，docs/architecture/frontend/19-observability.md §9.2 D7）', () => {
  it.each([
    ['email', 'user alice@example.com not found', 'user [email] not found'],
    ['JWT', 'bad token eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl', 'bad token [token]'],
    ['API token', 'key b2bt_abc123', 'key [token]'],
    ['長的亂數字串', `secret ${'a'.repeat(40)}`, 'secret [token]'],
    [
      '網址的 query string',
      'GET https://acme.example.com/reset?token=abc failed',
      'GET https://acme.example.com/reset failed',
    ],
    ['相對網址的 query string', 'fetch /api/users?email=a failed', 'fetch /api/users failed'],
  ])('遮掉%s', (_name, input, expected) => {
    expect(scrubText(input, 1000)).toBe(expected);
  });

  it('超過長度時截斷並加上 …', () => {
    expect(scrubText('abcdef', 3)).toBe('abc…');
  });

  it('一般的錯誤訊息不變', () => {
    expect(scrubText("Cannot read properties of undefined (reading 'id')", 1000)).toBe(
      "Cannot read properties of undefined (reading 'id')",
    );
  });
});

describe('scrubUrl', () => {
  it('只留 path，去掉 query 與 fragment', () => {
    expect(scrubUrl('https://acme.example.com/user/1?tab=a#x')).toBe(
      'https://acme.example.com/user/1',
    );
  });
});
