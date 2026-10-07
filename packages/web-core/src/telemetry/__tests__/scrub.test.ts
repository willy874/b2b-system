import { describe, expect, it } from 'vitest';

import { scrubText, toPathTemplate } from '../scrub';

describe('scrubText（上報前的遮罩，docs/architecture/frontend/19-observability.md §9.2 D7）', () => {
  it.each([
    ['email', 'invite alice@example.com failed', 'invite [email] failed'],
    ['JWT', 'token eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl', 'token [token]'],
    ['API token', 'b2bt_abc_123 rejected', '[token] rejected'],
    [
      '網址的 query string',
      'load https://acme.example.com/reset?token=abc',
      'load https://acme.example.com/reset',
    ],
  ])('遮掉%s', (_name, input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it('超過長度時截斷', () => {
    expect(scrubText('abcdef', 3)).toBe('abc…');
  });
});

describe('toPathTemplate（網址 → 不含 id 與 query 的形狀）', () => {
  const origin = 'https://acme.example.com';

  it.each([
    [
      'https://acme.example.com/api/users/0f8fad5b-d9cb-469f-a165-70867728950e?tab=a',
      '/api/users/:id',
    ],
    ['/api/files/123/download', '/api/files/:id/download'],
    ['/reset-password?token=secret', '/reset-password'],
    [
      'https://storage.example.com/bucket/abc?X-Amz-Signature=x',
      'https://storage.example.com/bucket/abc',
    ],
  ])('%s → %s', (input, expected) => {
    expect(toPathTemplate(input, origin)).toBe(expected);
  });
});
