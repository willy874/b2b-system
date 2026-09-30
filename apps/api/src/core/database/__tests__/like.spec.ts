import { describe, expect, it } from 'vitest';

import { containsPattern, escapeLike, prefixPattern } from '../like';

describe('escapeLike', () => {
  it.each([
    ['一般文字不變', 'alice', 'alice'],
    ['底線', 'a_b', 'a\\_b'],
    ['百分比', '100%', '100\\%'],
    ['反斜線本身', 'a\\b', 'a\\\\b'],
    ['混合', '%_\\', '\\%\\_\\\\'],
  ])('%s', (_name, input, expected) => {
    expect(escapeLike(input)).toBe(expected);
  });

  it('containsPattern 前後加 %，prefixPattern 只在後面加', () => {
    expect(containsPattern('a_b')).toBe('%a\\_b%');
    expect(prefixPattern('a_b')).toBe('a\\_b%');
  });
});
