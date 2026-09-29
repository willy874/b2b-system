import { describe, expect, it } from 'vitest';

import { formatBytes } from '../formatBytes';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [3.25 * 1024 ** 3, '3.3 GB'],
    [-1, '—'],
    [Number.NaN, '—'],
  ])('%s → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
