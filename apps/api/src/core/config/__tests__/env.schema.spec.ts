import { describe, expect, it } from 'vitest';

import { EnvSchema, parseTrustProxy } from '../env.schema';

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

describe('FILE_URL_TTL（SEC-16：撤銷授權的延遲上限）', () => {
  const ttl = EnvSchema.shape.FILE_URL_TTL;

  it('預設 900 秒', () => {
    expect(ttl.parse(undefined)).toBe(900);
  });

  it('最長 1 小時：更長的網址在授權撤銷後仍可下載太久', () => {
    expect(ttl.parse('3600')).toBe(3600);
    expect(ttl.safeParse('3601').success).toBe(false);
    expect(ttl.safeParse('604800').success).toBe(false);
  });
});
