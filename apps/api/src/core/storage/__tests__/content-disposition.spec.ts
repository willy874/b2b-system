import { describe, expect, it } from 'vitest';

import { contentDisposition } from '../content-disposition';

describe('contentDisposition（RFC 6266 / 5987）', () => {
  it.each([
    ['inline', 'hero.png', `inline; filename="hero.png"; filename*=UTF-8''hero.png`],
    [
      'attachment',
      '角色 1.png',
      `attachment; filename="__ 1.png"; filename*=UTF-8''%E8%A7%92%E8%89%B2%201.png`,
    ],
    [
      'attachment',
      `a"b\\c'(1).txt`,
      `attachment; filename="a_b_c'(1).txt"; filename*=UTF-8''a%22b%5Cc%27%281%29.txt`,
    ],
  ] as const)('%s %s', (disposition, name, expected) => {
    expect(contentDisposition(disposition, name)).toBe(expected);
  });
});
