import { describe, expect, it } from 'vitest';

import { parseTrustProxy } from '../env.schema';

describe('parseTrustProxy（TRUST_PROXY → Express trust proxy）', () => {
  it.each([
    ['', false],
    ['false', false],
    ['true', true],
    ['1', 1],
    [' 2 ', 2],
    ['uniquelocal', 'uniquelocal'],
    ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
  ])('%j → %j', (input, expected) => {
    expect(parseTrustProxy(input)).toBe(expected);
  });
});
